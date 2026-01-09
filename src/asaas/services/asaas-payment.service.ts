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

  resolvePaidAt(payment: AsaasPayment): Date {
    return new Date();
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
    else if (planValue === 'PRO_ANUAL' || planValue === 'PRO_ANUAL')
      planCode = SubscriptionPlan.PRO_ANUAL;
    else if (planValue === 'PLUS_ANUAL' || planValue === 'PLUS_ANUAL')
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
    const payment = await this.getPayment(id);
    const status = this.getPaymentStatus(payment) as AsaasPaymentStatus;
    const paidAt = ['CONFIRMED', 'RECEIVED'].includes(status) ? this.resolvePaidAt(payment) : null;

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
