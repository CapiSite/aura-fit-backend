import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionPlan } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PlanCode, AsaasBillingType } from './dto/create-plan-payment.dto';
import { AsaasCustomer, AsaasPayment } from './entities/asaas.types';
import { PrismaService } from 'src/prisma_connection/prisma.service';

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookToken: string;

  constructor(private readonly configService: ConfigService, private readonly prisma: PrismaService) {
    this.baseUrl =
      this.configService.get<string>('asaas.baseUrl') ??
      'https://sandbox.asaas.com/api/v3';
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

    const payload: any = {
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

  async createPlanPayment(
    planCode: PlanCode,
    customerId: string,
    opts: {
      externalReference?: string;
      dueDate?: string;
      paymentMethod?: AsaasBillingType;
      creditCard?: CreditCardPayload;
      holderInfo?: CreditCardHolderInfoPayload;
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

    const plan = pricing[planCode];
    if (!plan) {
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

    const dueDate = opts?.dueDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

    const payload: CreatePaymentInput = {
      customerId,
      value: plan.value,
      dueDate,
      description: plan.description,
      externalReference: opts?.externalReference ?? `${planCode}:${customerId}:${Date.now()}`,
      creditCard: opts.creditCard,
      creditCardHolderInfo: opts.holderInfo,
      billingType,
    };

    return this.createPayment(payload);
  }

  async handleWebhook(body: any, token?: string) {
    if (this.webhookToken && token !== this.webhookToken) {
      throw new HttpException('Unauthorized webhook', HttpStatus.UNAUTHORIZED);
    }

    const payment = body?.payment ?? body;
    if (!payment) return { ok: false };

    const status = (payment.status ?? '').toString().toUpperCase();
    if (!['CONFIRMED', 'RECEIVED'].includes(status)) {
      return { ok: true, ignored: true };
    }

    const ext = (payment.externalReference ?? '').toString();
    const [planRaw, chatIdFromExt] = ext.split(':');
    const chatId = chatIdFromExt || (payment?.customer ?? '');
    const planCode = planRaw?.toUpperCase() === 'PRO' ? SubscriptionPlan.PRO : SubscriptionPlan.PLUS;

    if (!chatId) {
      this.logger.warn('Webhook payment without chatId, skipping');
      return { ok: false };
    }

    const paidAt = payment.confirmedDate
      ? new Date(payment.confirmedDate)
      : new Date(payment.paymentDate ?? Date.now());
    const expiresAt = new Date(paidAt);
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          chatId: String(chatId),
          amount: Number(payment.value ?? 0),
          plan: planCode,
          status,
          method: payment.billingType ?? 'CREDIT_CARD',
          paidAt,
        },
      }),
      this.prisma.userProfile.update({
        where: { chatId: String(chatId) },
        data: {
          subscriptionPlan: planCode,
          isPaymentActive: true,
          lastPaymentAt: paidAt,
          subscriptionExpiresAt: expiresAt,
          nextBillingAt: expiresAt,
        },
      }),
    ]);

    return { ok: true };
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
    } catch (error: any) {
      const status = (typeof error?.getStatus === 'function' && error.getStatus()) || 0;
      if (status === HttpStatus.CONFLICT || status === HttpStatus.BAD_REQUEST) {
        const existing = await this.findCustomerByCpf(profile.cpfCnpj);
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async findCustomerByCpf(cpfCnpj: string): Promise<AsaasCustomer | null> {
    try {
      const result = await this.request<any>(`/customers?cpfCnpj=${cpfCnpj}`, { method: 'GET' });
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
    let data: any = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch (parseError) {
      this.logger.warn(`Falha ao parsear resposta do Asaas em ${path}: ${text}`);
    }

    if (!response.ok) {
      const description =
        data?.errors?.[0]?.description ||
        data?.message ||
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
