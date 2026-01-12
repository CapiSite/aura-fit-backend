import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { AsaasBillingType } from '../dto/create-plan-payment.dto';
import {
  AsaasPayment,
  AsaasPaymentStatus,
  CreditCardHolderInfoPayload,
  CreditCardPayload,
} from '../entities/asaas.types';
import { AsaasApiClient } from './asaas-api.client';

export interface CreatePaymentInput {
  customerId: string;
  billingType?: AsaasBillingType;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  creditCard?: CreditCardPayload;
  creditCardHolderInfo?: CreditCardHolderInfoPayload;
}

@Injectable()
export class AsaasPaymentService {
  private readonly logger = new Logger(AsaasPaymentService.name);

  constructor(
    private readonly apiClient: AsaasApiClient,
    private readonly prisma: PrismaService,
  ) { }

  private parseAsaasDate(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      return new Date(Date.UTC(year, month, day));
    }
    return new Date(value);
  }

  async createPayment(dto: CreatePaymentInput): Promise<AsaasPayment> {
    const billingType = dto.billingType ?? AsaasBillingType.CREDIT_CARD;

    const payload: {
      customer: string;
      billingType: AsaasBillingType;
      value: number;
      dueDate: string;
      description?: string;
      externalReference?: string;
      creditCard?: CreditCardPayload;
      creditCardHolderInfo?: CreditCardHolderInfoPayload;
    } = {
      customer: dto.customerId,
      billingType,
      value: dto.value,
      dueDate: dto.dueDate,
      description: dto.description,
      externalReference: dto.externalReference,
    };

    if (billingType === AsaasBillingType.CREDIT_CARD) {
      payload.creditCard = dto.creditCard;
      payload.creditCardHolderInfo = dto.creditCardHolderInfo;
    }

    this.logger.debug(
      `[AsaasService] Sending Payload: ${JSON.stringify(
        {
          ...payload,
          creditCard: payload.creditCard
            ? { ...payload.creditCard, number: '****', ccv: '***' }
            : undefined,
        },
        null,
        2,
      )}`,
    );

    return this.apiClient.request<AsaasPayment>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getPayment(id: string): Promise<AsaasPayment> {
    return this.apiClient.request<AsaasPayment>(`/payments/${id}`, { method: 'GET' });
  }

  async getPaymentBySubscription(subscriptionId: string): Promise<AsaasPayment | null> {
    const result = await this.apiClient.request<{
      data?: AsaasPayment[];
      payments?: AsaasPayment[];
    }>(`/payments?subscription=${subscriptionId}&limit=1`, { method: 'GET' });

    const list = result?.data ?? result?.payments ?? [];
    return list[0] ?? null;
  }

  async getUpcomingPaymentBySubscription(subscriptionId: string): Promise<AsaasPayment | null> {
    const result = await this.apiClient.request<{
      data?: AsaasPayment[];
      payments?: AsaasPayment[];
    }>(`/payments?subscription=${subscriptionId}&limit=20`, { method: 'GET' });

    const list = (result?.data ?? result?.payments ?? []).filter(Boolean);
    if (!list.length) return null;

    const ignoredStatuses = new Set([
      'CANCELLED',
      'REFUNDED',
      'CHARGED_BACK',
      'RECEIVED_IN_CASH_UNDONE',
    ]);
    const candidates = list.filter((payment) => !ignoredStatuses.has(payment.status));
    const pool = candidates.length ? candidates : list;

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let upcoming: AsaasPayment | null = null;
    let latest: AsaasPayment | null = null;

    for (const payment of pool) {
      const due = this.parseAsaasDate(payment.dueDate);
      if (!latest || due.getTime() > this.parseAsaasDate(latest.dueDate).getTime()) {
        latest = payment;
      }
      if (due.getTime() > todayUtc.getTime()) {
        if (!upcoming || due.getTime() < this.parseAsaasDate(upcoming.dueDate).getTime()) {
          upcoming = payment;
        }
      }
    }

    return upcoming ?? latest;
  }

  async getPixQrCode(
    id: string,
  ): Promise<{ encodedImage: string; payload: string; expirationDate: string } | null> {
    try {
      return await this.apiClient.request<{
        encodedImage: string;
        payload: string;
        expirationDate: string;
      }>(`/payments/${id}/pixQrCode`, { method: 'GET' });
    } catch (e) {
      this.logger.warn(`Falha ao obter QR Code PIX para pagamento ${id}`);
      return null;
    }
  }

  getPaymentStatus(payment: AsaasPayment): string {
    return (payment?.status ?? '').toString().toUpperCase();
  }

  private parsePaymentDate(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  resolvePaidAt(payment: AsaasPayment): Date {
    const paidAt =
      this.parsePaymentDate(payment.confirmedDate) ??
      this.parsePaymentDate(payment.paymentDate) ??
      this.parsePaymentDate(payment.clientPaymentDate);

    if (paidAt) return paidAt;

    const dueDate = this.parsePaymentDate(payment.dueDate);
    const now = new Date();
    if (dueDate && dueDate <= now) return dueDate;

    return now;
  }

  async upsertPaymentRecord(data: {
    payment: AsaasPayment;
    status: string;
    plan: SubscriptionPlan;
    chatId: string;
    paidAt: Date | null;
  }) {
    const { payment, status, plan, chatId, paidAt } = data;

    // Ensure user exists
    const user = await this.prisma.userProfile.findUnique({
      where: { phoneNumber: String(chatId) },
      select: { id: true }
    });

    if (!user) {
      this.logger.warn(`User not found for chatId ${chatId}, skipping payment persistence`);
      return;
    }

    const commonData = {
      asaasPaymentId: payment.id,
      status,
      amount: Number(payment.value ?? 0),
      method: payment.billingType ?? 'CREDIT_CARD',
      plan,
      paidAt,
      invoiceUrl: payment.invoiceUrl,
      bankSlipUrl: payment.bankSlipUrl,
      transactionReceiptUrl: payment.transactionReceiptUrl,
      pixQrCode: payment.pixTransaction?.qrCode,
      pixPayload: payment.pixTransaction?.payload,
      dueDate: new Date(payment.dueDate)
    };

    await this.prisma.payment.upsert({
      where: { asaasPaymentId: payment.id },
      create: {
        userId: user.id,
        ...commonData,
      },
      update: {
        status,
        paidAt,
        amount: Number(payment.value ?? 0), // Update amount in case it changed
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        transactionReceiptUrl: payment.transactionReceiptUrl,
        pixQrCode: payment.pixTransaction?.qrCode,
        pixPayload: payment.pixTransaction?.payload,
      },
    });
  }

  extractPaymentContext(payment: AsaasPayment): { chatId: string; planCode: SubscriptionPlan } {
    const ext = (payment?.externalReference ?? '').toString();
    const parts = ext.split(':');

    let planValue = parts[0];
    let chatIdFromExt = parts[1];

    if (planValue === 'UPGRADE') {
      planValue = parts[1] || '';
      chatIdFromExt = parts[2] || '';
    }

    planValue = (planValue ?? '').toString().trim().toUpperCase();

    let planCode: SubscriptionPlan;
    if (planValue === 'PRO') planCode = SubscriptionPlan.PRO;
    else if (planValue === 'PRO_ANUAL')
      planCode = SubscriptionPlan.PRO_ANUAL;
    else if (planValue === 'PLUS_ANUAL')
      planCode = SubscriptionPlan.PLUS_ANUAL;
    else planCode = SubscriptionPlan.PLUS;

    const chatId = chatIdFromExt ?? '';
    return { chatId: String(chatId ?? ''), planCode };
  }

  async resolvePaymentContext(
    payment: AsaasPayment,
  ): Promise<{ chatId: string; planCode: SubscriptionPlan }> {
    const paymentId = payment?.id;
    if (paymentId) {
      const record = await this.prisma.payment.findUnique({
        where: { asaasPaymentId: paymentId },
        select: { userId: true, plan: true, user: { select: { phoneNumber: true } } },
      });
      if (record?.user?.phoneNumber && record?.plan) {
        return { chatId: String(record.user.phoneNumber), planCode: record.plan };
      }
    }
    return this.extractPaymentContext(payment);
  }

  async checkPaymentStatus(
    id: string,
    chatId: string,
  ): Promise<{ status: AsaasPaymentStatus; updated: boolean }> {
    let payment: AsaasPayment | null = null;

    if (id.startsWith('sub_')) {
      try {
        payment = await this.getPaymentBySubscription(id);
      } catch (error) {
        this.logger.warn(`Falha ao buscar pagamento para subscription ${id}`);
      }
      if (!payment) {
        return { status: 'PENDING', updated: false };
      }
    } else {
      payment = await this.getPayment(id);
    }

    const status = this.getPaymentStatus(payment) as AsaasPaymentStatus;
    const paidAt = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status)
      ? this.resolvePaidAt(payment)
      : null;

    // Apenas atualiza registro, não aplica lógica de assinatura aqui.
    // O Controller que chame o SubscriptionService se precisar aplicar.
    // Mas upsertPaymentRecord precisa do PlanCode.
    const context = this.extractPaymentContext(payment);
    const plan = context.planCode; // ou pegar do DB se já existir?

    await this.upsertPaymentRecord({
      payment,
      status,
      plan,
      chatId,
      paidAt,
    });

    return { status, updated: false };
  }
}
