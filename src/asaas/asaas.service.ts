import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionPlan } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PlanCode, AsaasBillingType } from './dto/create-plan-payment.dto';
import { AsaasCustomer, AsaasPayment, AsaasWebhookPayload } from './entities/asaas.types';
import { PrismaService } from '../prisma_connection/prisma.service';

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookToken: string;

  constructor(private readonly configService: ConfigService, private readonly prisma: PrismaService) {
    const rawBaseUrl =
      this.configService.get<string>('asaas.baseUrl') ??
      'https://sandbox.asaas.com/api/v3';
    this.baseUrl = this.normalizeBaseUrl(rawBaseUrl);
    this.apiKey = this.configService.get<string>('asaas.apiKey') ?? '';
    this.webhookToken = this.configService.get<string>('ASAAS_WEBHOOK_TOKEN') ?? '';
  }

  async createCustomer(dto: CreateCustomerDto): Promise<AsaasCustomer> {
    return this.request<AsaasCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
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

    return this.request<AsaasPayment>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getPayment(id: string): Promise<AsaasPayment> {
    return this.request<AsaasPayment>(`/payments/${id}`, { method: 'GET' });
  }

  async checkPaymentStatus(id: string, expectedChatId?: string) {
    const payment = await this.getPayment(id);
    if (
      payment?.billingType === AsaasBillingType.PIX &&
      (!payment?.pixTransaction?.qrCode || !payment?.pixTransaction?.payload)
    ) {
      const pix = await this.getPixQrCode(payment.id);
      if (pix) {
        payment.pixTransaction = {
          ...payment.pixTransaction,
          qrCode: pix.qrCode,
          payload: pix.payload,
        };
      }
    }
    const status = this.getPaymentStatus(payment);
    const { chatId, planCode } = await this.resolvePaymentContext(payment);

    if (expectedChatId && chatId && String(chatId) !== String(expectedChatId)) {
      throw new HttpException('Pagamento nao pertence ao usuario', HttpStatus.FORBIDDEN);
    }

    await this.upsertPaymentRecord({
      payment,
      status,
      plan: planCode,
      chatId,
    });

    if (['CONFIRMED', 'RECEIVED'].includes(status)) {
      const updated = await this.applyConfirmedPayment(payment, status);
      return { status, updated, plan: planCode };
    }

    return { status, updated: false };
  }

  async createPlanPayment(
    planCode: PlanCode,
    customerId: string,
    opts: {
      dueDate?: string;
      paymentMethod?: AsaasBillingType;
      creditCard?: CreditCardPayload;
      holderInfo?: CreditCardHolderInfoPayload;
      chatId?: string;
    },
  ): Promise<AsaasPayment> {
    const pricing: Record<PlanCode, { value: number; description: string }> = {
      [PlanCode.PLUS]: {
        value: 29.9,
        description: 'Plano Plus - 20 mensagens/dia e 2 fotos/dia',
      },
      [PlanCode.PRO]: {
        value: 49.9,
        description: 'Plano Pro - 40 mensagens/dia e 5 fotos/dia',
      },
    };

    const pricingInfo = pricing[planCode];
    if (!pricingInfo) {
      throw new HttpException('Plano inválido', HttpStatus.BAD_REQUEST);
    }

    const billingType = opts.paymentMethod ?? AsaasBillingType.CREDIT_CARD;

    if (billingType !== AsaasBillingType.PIX) {
      const cc = opts.creditCard;
      const holder = opts.holderInfo;
      const num = cc?.number?.replace(/\D/g, '') ?? '';
      const cvv = cc?.ccv?.replace(/\D/g, '') ?? '';
      const month = cc?.expiryMonth ?? '';
      const year = cc?.expiryYear ?? '';
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      if (!num || num.length < 13 || num.length > 19) {
        throw new HttpException('Numero de cartao invalido', HttpStatus.BAD_REQUEST);
      }
      if (!cvv || cvv.length < 3 || cvv.length > 4) {
        throw new HttpException('CVV invalido', HttpStatus.BAD_REQUEST);
      }
      const m = Number(month);
      const y = Number(year);
      if (!m || m < 1 || m > 12 || !y || y < currentYear || (y === currentYear && m < currentMonth)) {
        throw new HttpException('Validade do cartao invalida', HttpStatus.BAD_REQUEST);
      }
      if (!holder?.name || !holder?.cpfCnpj) {
        throw new HttpException('Dados do portador obrigatorios', HttpStatus.BAD_REQUEST);
      }
    }

    const dueDate = new Date().toISOString().slice(0, 10);

    const payload: CreatePaymentInput = {
      customerId,
      value: pricingInfo.value,
      dueDate,
      description: pricingInfo.description,
      externalReference: `${planCode}:${opts.chatId ?? ''}:${Date.now()}`,
      creditCard: opts.creditCard,
      creditCardHolderInfo: opts.holderInfo,
      billingType,
    };

    const payment = await this.createPayment(payload);
    if (billingType === AsaasBillingType.PIX) {
      const pix = await this.getPixQrCode(payment.id);
      if (pix) {
        payment.pixTransaction = {
          ...payment.pixTransaction,
          qrCode: pix.qrCode,
          payload: pix.payload,
        };
      }
    }
    const status = this.getPaymentStatus(payment);
    const planEnum = this.mapPlanCode(planCode);
    const contextChatId = opts.chatId ?? this.extractPaymentContext(payment).chatId;
    const paidAt = ['CONFIRMED', 'RECEIVED'].includes(status) ? this.resolvePaidAt(payment) : null;
    await this.upsertPaymentRecord({
      payment,
      status,
      plan: planEnum,
      chatId: contextChatId,
      paidAt,
    });
    if (['CONFIRMED', 'RECEIVED'].includes(status)) {
      await this.applyConfirmedPayment(payment, status);
    }
    return payment;
  }

  async handleWebhook(body: AsaasWebhookPayload | AsaasPayment, token?: string) {
    if (this.webhookToken && token !== this.webhookToken) {
      throw new HttpException('Unauthorized webhook', HttpStatus.UNAUTHORIZED);
    }

    const payment = 'payment' in body ? body.payment : body;
    if (!payment) return { ok: false };

    const status = this.getPaymentStatus(payment);
    if (!['CONFIRMED', 'RECEIVED'].includes(status)) {
      return { ok: true, ignored: true };
    }

    const updated = await this.applyConfirmedPayment(payment, status);
    return { ok: true, updated };
  }

  private getPaymentStatus(payment: AsaasPayment): string {
    return (payment?.status ?? '').toString().toUpperCase();
  }

  private extractPaymentContext(payment: AsaasPayment): { chatId: string; planCode: SubscriptionPlan } {
    const ext = (payment?.externalReference ?? '').toString();
    const [planRaw, chatIdFromExt] = ext.split(':');
    const planValue = (planRaw ?? '').toString().trim().toUpperCase();
    const planCode = planValue === 'PRO' ? SubscriptionPlan.PRO : SubscriptionPlan.PLUS;
    const chatId = chatIdFromExt ?? '';
    return { chatId: String(chatId ?? ''), planCode };
  }

  private async resolvePaymentContext(payment: AsaasPayment): Promise<{ chatId: string; planCode: SubscriptionPlan }> {
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

  private resolvePaidAt(payment: AsaasPayment): Date {
    const raw = payment?.confirmedDate ?? payment?.paymentDate ?? payment?.clientPaymentDate;
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private mapPlanCode(planCode: PlanCode): SubscriptionPlan {
    return planCode === PlanCode.PRO ? SubscriptionPlan.PRO : SubscriptionPlan.PLUS;
  }

  private getPlanAmount(planCode: SubscriptionPlan): number {
    return planCode === SubscriptionPlan.PRO ? 49.9 : 29.9;
  }

  private parseDate(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async getPixQrCode(paymentId: string): Promise<{ qrCode: string; payload: string } | null> {
    if (!paymentId) return null;
    try {
      const result = await this.request<{ encodedImage?: string; qrCode?: string; payload?: string }>(
        `/payments/${paymentId}/pixQrCode`,
        { method: 'GET' },
      );
      const qrCode = (result?.encodedImage ?? result?.qrCode ?? '').toString().trim();
      const payload = (result?.payload ?? '').toString().trim();
      if (!qrCode && !payload) return null;
      return { qrCode, payload };
    } catch (error) {
      this.logger.warn(`Falha ao obter QR Code PIX para pagamento ${paymentId}`, error as Error);
      return null;
    }
  }

  private async upsertPaymentRecord(params: {
    payment: AsaasPayment;
    chatId: string;
    plan: SubscriptionPlan;
    status: string;
    paidAt?: Date | null;
  }) {
    const { payment, chatId, plan, status, paidAt } = params;
    if (!payment?.id || !chatId) {
      this.logger.warn('Pagamento sem identificador ou chatId, ignorando persistencia');
      return;
    }

    const dueDate = this.parseDate(payment.dueDate);
    const data = {
      asaasPaymentId: payment.id,
      amount: Number(payment.value ?? 0),
      plan,
      status,
      method: payment.billingType ?? 'CREDIT_CARD',
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
      transactionReceiptUrl: payment.transactionReceiptUrl ?? null,
      pixQrCode: payment.pixTransaction?.qrCode ?? null,
      pixPayload: payment.pixTransaction?.payload ?? null,
      dueDate,
    };

    // Busca o user para obter o userId
    const user = await this.prisma.userProfile.findUnique({
      where: { phoneNumber: String(chatId) },
      select: { id: true },
    });

    if (!user) {
      this.logger.warn(`User not found for chatId ${chatId}, ignorando persistencia`);
      return;
    }

    await this.prisma.payment.upsert({
      where: { asaasPaymentId: payment.id },
      update: {
        ...data,
        ...(paidAt ? { paidAt } : {}),
      },
      create: {
        userId: user.id,
        ...data,
        paidAt: paidAt ?? null,
      },
    });
  }

  private async applyConfirmedPayment(payment: AsaasPayment, status: string): Promise<boolean> {
    const { chatId, planCode } = await this.resolvePaymentContext(payment);
    if (!chatId) {
      this.logger.warn('Payment without chatId, skipping');
      return false;
    }

    const paidAt = this.resolvePaidAt(payment);
    const profile = await this.prisma.userProfile.findUnique({
      where: { phoneNumber: String(chatId) },
      select: { lastPaymentAt: true, subscriptionPlan: true, isPaymentActive: true },
    });

    if (!profile) {
      this.logger.warn(`Payment for unknown chatId ${chatId}, skipping`);
      return false;
    }

    await this.upsertPaymentRecord({
      payment,
      status,
      plan: planCode,
      chatId,
      paidAt,
    });

    const expectedAmount = this.getPlanAmount(planCode);
    const receivedAmount = Number(payment.value ?? 0);
    if (receivedAmount + 0.01 < expectedAmount) {
      this.logger.warn(
        `Pagamento abaixo do esperado. paymentId=${payment.id} expected=${expectedAmount} received=${receivedAmount}`,
      );
      return false;
    }

    const alreadyApplied =
      profile.isPaymentActive &&
      profile.subscriptionPlan === planCode &&
      profile.lastPaymentAt &&
      profile.lastPaymentAt >= paidAt;

    if (alreadyApplied) return false;

    const expiresAt = new Date(paidAt);
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.userProfile.update({
      where: { phoneNumber: String(chatId) },
      data: {
        subscriptionPlan: planCode,
        isPaymentActive: true,
        lastPaymentAt: paidAt,
        subscriptionExpiresAt: expiresAt,
        nextBillingAt: expiresAt,
      },
    });

    return true;
  }

  async ensureCustomerFromProfile(profile: {
    name: string;
    cpfCnpj: string;
    email?: string;
    phone?: string;
    mobilePhone?: string;
  }): Promise<AsaasCustomer> {
    const dto: CreateCustomerDto = {
      name: profile.name,
      cpfCnpj: profile.cpfCnpj,
      email: profile.email,
      phone: profile.phone,
      mobilePhone: profile.mobilePhone,
    };

    try {
      return await this.createCustomer(dto);
    } catch (error: unknown) {
      const status =
        typeof (error as { getStatus?: () => number }).getStatus === 'function'
          ? (error as { getStatus: () => number }).getStatus()
          : 0;
      if (status === HttpStatus.CONFLICT || status === HttpStatus.BAD_REQUEST) {
        const existing = await this.findCustomerByCpf(profile.cpfCnpj);
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async findCustomerByCpf(cpfCnpj: string): Promise<AsaasCustomer | null> {
    try {
      const result = await this.request<{ data?: AsaasCustomer[]; customers?: AsaasCustomer[] }>(
        `/customers?cpfCnpj=${cpfCnpj}`,
        { method: 'GET' },
      );
      const list: AsaasCustomer[] = result?.data ?? result?.customers ?? [];
      return list[0] ?? null;
    } catch (error) {
      this.logger.warn(`Nao foi possivel localizar cliente Asaas por CPF ${cpfCnpj}`);
      return null;
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit & { body?: string },
  ): Promise<T> {
    if (!this.apiKey) {
      this.logger.error('ASAAS_API_KEY ausente. Pagamentos indisponiveis.');
      throw new HttpException(
        'Pagamento indisponivel no momento. Tente novamente em instantes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch (parseError) {
      this.logger.warn(`Falha ao parsear resposta do Asaas em ${path}: ${text}`);
    }

    if (!response.ok) {
      const responseData = data as { errors?: { description?: string }[]; message?: string } | undefined;
      const description =
        responseData?.errors?.[0]?.description ||
        responseData?.message ||
        'Erro ao comunicar com o Asaas';

      this.logger.error(
        `Asaas error ${response.status}: ${description}`,
        text,
      );

      const userMessage =
        response.status === HttpStatus.BAD_REQUEST ||
          response.status === HttpStatus.PAYMENT_REQUIRED ||
          response.status === HttpStatus.UNPROCESSABLE_ENTITY
          ? 'Dados de pagamento invalidos. Verifique as informacoes e tente novamente.'
          : 'Nao foi possivel processar o pagamento agora. Tente novamente em instantes.';

      throw new HttpException(
        userMessage,
        (response.status as HttpStatus) || HttpStatus.BAD_GATEWAY,
      );
    }

    return data as T;
  }

  private normalizeBaseUrl(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) return 'https://sandbox.asaas.com/api/v3';
    const collapsed = trimmed.replace(/\/api\/api\/v3$/i, '/api/v3');
    if (/\/api$/i.test(collapsed)) {
      return `${collapsed}/v3`;
    }
    return collapsed;
  }
}
type CreatePaymentInput = {
  customerId: string;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  billingType?: AsaasBillingType;
  creditCard?: CreditCardPayload;
  creditCardHolderInfo?: CreditCardHolderInfoPayload;
};

type CreditCardPayload = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};

type CreditCardHolderInfoPayload = {
  name: string;
  email?: string;
  cpfCnpj: string;
  postalCode?: string;
  addressNumber?: string;
};
