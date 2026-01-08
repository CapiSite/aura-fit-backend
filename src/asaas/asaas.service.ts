import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionPlan } from '@prisma/client';
import { PLAN_CHANGE_CONFIG } from './config/plan-change.config';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import { AsaasBillingType } from './dto/create-plan-payment.dto';
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

    // DEBUG: Log Asaas Payload
    this.logger.debug(`[AsaasService] Sending Payload: ${JSON.stringify({
      ...payload,
      creditCard: payload.creditCard ? { ...payload.creditCard, number: '****', ccv: "***" } : undefined
    }, null, 2)}`);

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
    planCode: SubscriptionPlan,
    customerId: string,
    opts: {
      dueDate?: string;
      paymentMethod?: AsaasBillingType;
      creditCard?: CreditCardPayload;
      holderInfo?: CreditCardHolderInfoPayload;
      chatId?: string;
    },
  ): Promise<AsaasPayment> {
    // SECURITY: Block FREE plan from being processed as payment
    if (planCode === SubscriptionPlan.FREE) {
      this.logger.warn(`Attempt to process FREE plan as payment blocked`);
      throw new HttpException(
        'Plano FREE não pode ser processado via pagamento',
        HttpStatus.BAD_REQUEST,
      );
    }

    const pricing: Record<SubscriptionPlan, { value: number; description: string }> = {
      [SubscriptionPlan.FREE]: {
        value: 0,
        description: 'Plano Free',
      },
      [SubscriptionPlan.PLUS]: {
        value: 29.9,
        description: 'Plano Plus - 20 mensagens/dia e 2 fotos/dia',
      },
      [SubscriptionPlan.PRO]: {
        value: 49.9,
        description: 'Plano Pro - 40 mensagens/dia e 5 fotos/dia',
      },
      [SubscriptionPlan.PLUS_ANUAL]: {
        value: 287.0,
        description: 'Plano Plus Anual - 20 mensagens/dia e 2 fotos/dia (12 meses)',
      },
      [SubscriptionPlan.PRO_ANUAL]: {
        value: 479.0,
        description: 'Plano Pro Anual - 40 mensagens/dia e 5 fotos/dia (12 meses)',
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

    // AUDIT LOG: Record payment attempt
    this.logger.log(
      `Payment creation - User: ${opts.chatId}, Plan: ${planCode}, Value: ${pricingInfo.value}, Method: ${billingType}`,
    );

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
    const planEnum = planCode;
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

  async createPlanChangePayment(
    userId: number,
    targetPlan: SubscriptionPlan,
    customerId: string,
    opts: {
      paymentMethod?: AsaasBillingType;
      creditCard?: CreditCardPayload;
      holderInfo?: CreditCardHolderInfoPayload;
      chatId?: string;
    },
  ): Promise<{ payment?: AsaasPayment; changeInfo: any }> {
    // SECURITY: Bloquear plano FREE
    if (targetPlan === SubscriptionPlan.FREE) {
      this.logger.warn(`Tentativa de mudança para FREE bloqueada - User: ${userId}, ChatId: ${opts.chatId}`);
      throw new HttpException(
        'Não é possível fazer downgrade para plano FREE',
        HttpStatus.FORBIDDEN,
      );
    }

    const user = await this.prisma.userProfile.findUnique({
      where: { id: userId },
      select: {
        subscriptionPlan: true,
        subscriptionExpiresAt: true,
        isPaymentActive: true,
        pendingPlan: true,
      },
    });

    if (!user) {
      throw new HttpException('Usuário não encontrado', HttpStatus.NOT_FOUND);
    }

    if (!user.isPaymentActive || !user.subscriptionExpiresAt) {
      throw new HttpException('Nenhuma assinatura ativa para alterar', HttpStatus.BAD_REQUEST);
    }

    // SECURITY: Validar que assinatura não expirou
    if (new Date(user.subscriptionExpiresAt) <= new Date()) {
      throw new HttpException('Assinatura expirada', HttpStatus.BAD_REQUEST);
    }

    // Calcular mudança de plano
    const planChange = this.calculatePlanChange(
      user.subscriptionPlan,
      targetPlan,
      user.subscriptionExpiresAt,
    );

    if (!planChange.canChange) {
      throw new HttpException(
        planChange.reason || 'Mudança de plano não permitida',
        HttpStatus.BAD_REQUEST,
      );
    }

    // DOWNGRADE: Agendar para próximo ciclo (sem cobrança)
    if (planChange.isDowngrade) {
      // SECURITY: Verificar se não há pagamento pendente (evitar race condition)
      const pendingPayments = await this.prisma.payment.count({
        where: {
          userId,
          status: { in: ['PENDING', 'PENDING_PIX'] },
          createdAt: { gte: new Date(Date.now() - PLAN_CHANGE_CONFIG.PENDING_PAYMENT_WINDOW_MS) },
        },
      });

      if (pendingPayments > 0) {
        throw new HttpException(
          'Você tem um pagamento pendente. Aguarde a confirmação antes de agendar downgrade.',
          HttpStatus.CONFLICT,
        );
      }

      await this.prisma.userProfile.update({
        where: { id: userId },
        data: { pendingPlan: targetPlan },
      });

      const userHash = opts.chatId ? opts.chatId.slice(-4) : 'unknown';
      this.logger.log(
        `Downgrade agendado - UserHash: ****${userHash}, From: ${user.subscriptionPlan}, To: ${targetPlan}`,
      );

      return {
        changeInfo: {
          changed: false,
          scheduled: true,
          isDowngrade: true,
          charged: false,
          currentPlan: user.subscriptionPlan,
          targetPlan,
          daysRemaining: planChange.daysRemaining,
          effectiveDate: user.subscriptionExpiresAt,
        },
      };
    }

    // UPGRADE: Cobrar diferença e ativar imediatamente
    if (planChange.changePrice < PLAN_CHANGE_CONFIG.FREE_UPGRADE_THRESHOLD) {
      // SECURITY: Usar transação para garantir atomicidade
      await this.prisma.$transaction(async (tx) => {
        // Revalidar dentro da transação para evitar race condition
        const currentUser = await tx.userProfile.findUnique({
          where: { id: userId },
          select: { subscriptionPlan: true, isPaymentActive: true, subscriptionExpiresAt: true },
        });

        if (!currentUser?.isPaymentActive || !currentUser.subscriptionExpiresAt) {
          throw new HttpException('Assinatura inválida', HttpStatus.BAD_REQUEST);
        }

        if (new Date(currentUser.subscriptionExpiresAt) <= new Date()) {
          throw new HttpException('Assinatura expirada', HttpStatus.BAD_REQUEST);
        }

        await tx.userProfile.update({
          where: {
            id: userId,
            subscriptionPlan: currentUser.subscriptionPlan,
            isPaymentActive: true,
          },
          data: {
            subscriptionPlan: targetPlan,
            pendingPlan: null,
          },
        });
      });

      const userHash = opts.chatId ? opts.chatId.slice(-4) : 'unknown';
      this.logger.log(
        `Free upgrade - UserHash: ****${userHash}, From: ${user.subscriptionPlan}, To: ${targetPlan}`,
      );

      return {
        changeInfo: {
          changed: true,
          scheduled: false,
          isDowngrade: false,
          charged: false,
          upgradePrice: 0,
          daysRemaining: planChange.daysRemaining,
        },
      };
    }

    // Criar pagamento para upgrade
    const billingType = opts.paymentMethod ?? AsaasBillingType.CREDIT_CARD;
    const description = `Upgrade de ${user.subscriptionPlan} para ${targetPlan} (${planChange.daysRemaining} dias)`;

    this.logger.log(
      `Upgrade payment - User: ${opts.chatId}, From: ${user.subscriptionPlan}, To: ${targetPlan}, Days: ${planChange.daysRemaining}, Price: ${planChange.changePrice}`,
    );

    const dueDate = new Date().toISOString().slice(0, 10);
    const payload: CreatePaymentInput = {
      customerId,
      value: planChange.changePrice,
      dueDate,
      description,
      externalReference: `UPGRADE:${targetPlan}:${opts.chatId}:${Date.now()}`,
      creditCard: opts.creditCard,
      creditCardHolderInfo: opts.holderInfo,
      billingType,
    };

    const payment = await this.createPayment(payload);

    await this.upsertPaymentRecord({
      payment,
      status: this.getPaymentStatus(payment),
      plan: targetPlan,
      chatId: opts.chatId || '',
      paidAt: null,
    });

    const status = this.getPaymentStatus(payment);
    if (['CONFIRMED', 'RECEIVED'].includes(status)) {
      await this.applyConfirmedPayment(payment, status);
    }

    return {
      payment,
      changeInfo: {
        changed: false,
        scheduled: false,
        isDowngrade: false,
        charged: true,
        upgradePrice: planChange.changePrice,
        daysRemaining: planChange.daysRemaining,
        currentPlan: user.subscriptionPlan,
        targetPlan,
      },
    };
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
    const parts = ext.split(':');

    let planValue = parts[0];
    let chatIdFromExt = parts[1];

    // Se tiver prefixo UPGRADE, o plano está na segunda posição
    if (planValue === 'UPGRADE') {
      planValue = parts[1] || '';
      chatIdFromExt = parts[2] || '';
    }

    planValue = (planValue ?? '').toString().trim().toUpperCase();

    let planCode: SubscriptionPlan;
    if (planValue === 'PRO') planCode = SubscriptionPlan.PRO;
    else if (planValue === 'PRO_ANUAL' || planValue === 'PRO_ANUAL') planCode = SubscriptionPlan.PRO_ANUAL;
    else if (planValue === 'PLUS_ANUAL' || planValue === 'PLUS_ANUAL') planCode = SubscriptionPlan.PLUS_ANUAL;
    else planCode = SubscriptionPlan.PLUS;

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
    // Usar sempre a data/hora atual do servidor para evitar problemas de timezone
    // (Asaas retorna datas em UTC que aparecem como dia anterior no Brasil)
    return new Date();
  }



  private getPlanAmount(planCode: SubscriptionPlan): number {
    if (planCode === SubscriptionPlan.FREE) return 0;
    if (planCode === SubscriptionPlan.PRO) return 49.9;
    if (planCode === SubscriptionPlan.PRO_ANUAL) return 479.0;
    if (planCode === SubscriptionPlan.PLUS_ANUAL) return 287.0;
    return 29.9;
  }

  private calculatePlanChange(
    currentPlan: SubscriptionPlan,
    targetPlan: SubscriptionPlan,
    subscriptionExpiresAt: Date,
  ): {
    changePrice: number;
    daysRemaining: number;
    canChange: boolean;
    isDowngrade: boolean;
    reason?: string;
  } {
    const now = new Date();
    const expiresAt = new Date(subscriptionExpiresAt);

    // Validação 1: Plano expirado
    if (expiresAt <= now) {
      return {
        changePrice: 0,
        daysRemaining: 0,
        canChange: false,
        isDowngrade: false,
        reason: 'Plano expirado'
      };
    }

    // Validação 2: Mesmo plano
    if (currentPlan === targetPlan) {
      return {
        changePrice: 0,
        daysRemaining: 0,
        canChange: false,
        isDowngrade: false,
        reason: 'Mesmo plano'
      };
    }

    const currentValue = this.getPlanAmount(currentPlan);
    const targetValue = this.getPlanAmount(targetPlan);

    // SECURITY: Validar valores de plano
    const validPrices: number[] = PLAN_CHANGE_CONFIG.VALID_PRICES as unknown as number[];
    if (currentValue < 0 || targetValue < 0) {
      this.logger.error(`Valores negativos detectados: current=${currentValue}, target=${targetValue}`);
      throw new HttpException('Erro no cálculo de preço', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (!validPrices.includes(currentValue) || !validPrices.includes(targetValue)) {
      this.logger.error(
        `Valores inesperados: current=${currentValue}, target=${targetValue}, currentPlan=${currentPlan}, targetPlan=${targetPlan}`,
      );
      throw new HttpException('Erro no cálculo de preço', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Determinar se é upgrade ou downgrade
    const isDowngrade = targetValue < currentValue && !this.isAnnualUpgrade(currentPlan, targetPlan);

    // DOWNGRADE: Agendado para próximo ciclo (sem cobrança)
    if (isDowngrade) {
      return {
        changePrice: 0,
        daysRemaining,
        canChange: true,
        isDowngrade: true,
      };
    }

    // UPGRADE: Iniciar NOVO ciclo subtraindo crédito dos dias não utilizados
    const isCurrentAnnual = currentPlan.includes('ANUAL');
    const totalDays = isCurrentAnnual ? 365 : 30;
    const currentRemainingValue = (daysRemaining / totalDays) * currentValue;

    const isTargetAnnual = targetPlan.includes('ANUAL');
    const targetFullValue = targetValue; // Novo ciclo completo

    // Preço é o valor cheio do novo plano MENOS o crédito do plano atual
    const upgradePrice = Math.max(0, targetFullValue - currentRemainingValue);

    return {
      changePrice: Number(upgradePrice.toFixed(2)),
      daysRemaining: isTargetAnnual ? 365 : 30, // Novo ciclo completo
      canChange: true,
      isDowngrade: false,
    };
  }

  private isAnnualUpgrade(current: SubscriptionPlan, target: SubscriptionPlan): boolean {
    const monthlyPlans: SubscriptionPlan[] = [SubscriptionPlan.PLUS, SubscriptionPlan.PRO];
    const annualPlans: SubscriptionPlan[] = [SubscriptionPlan.PLUS_ANUAL, SubscriptionPlan.PRO_ANUAL];
    return monthlyPlans.includes(current) && annualPlans.includes(target);
  }

  // Método público para preview de mudança de plano (usado pelo controller)
  getPlanChangePreview(
    currentPlan: SubscriptionPlan,
    targetPlan: SubscriptionPlan,
    subscriptionExpiresAt: Date,
  ) {
    return this.calculatePlanChange(currentPlan, targetPlan, subscriptionExpiresAt);
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

    // SECURITY: Block FREE plan confirmations (double-check)
    if (planCode === SubscriptionPlan.FREE) {
      this.logger.warn(`Attempt to confirm FREE plan payment blocked. paymentId=${payment.id}`);
      return false;
    }

    // SECURITY: Minimum payment value validation
    const minAmount = 1.0;
    if (receivedAmount < minAmount) {
      this.logger.warn(
        `Pagamento muito baixo rejeitado. paymentId=${payment.id} received=${receivedAmount} min=${minAmount}`,
      );
      return false;
    }

    const ref = (payment.externalReference || '').toString().toUpperCase();
    const isUpgrade = ref.startsWith('UPGRADE:');

    this.logger.log(`Payment Validation - ID: ${payment.id}, Ref: ${ref}, IsUpgrade: ${isUpgrade}, Received: ${receivedAmount}, Expected: ${expectedAmount}, Plan: ${planCode}`);

    if (!isUpgrade && receivedAmount + 0.01 < expectedAmount) {
      this.logger.warn(
        `Pagamento abaixo do esperado (REJEITADO). paymentId=${payment.id} expected=${expectedAmount} received=${receivedAmount}`,
      );
      return false;
    }

    const alreadyApplied =
      profile.isPaymentActive &&
      profile.subscriptionPlan === planCode &&
      profile.lastPaymentAt &&
      profile.lastPaymentAt >= paidAt;

    if (alreadyApplied) return false;

    // Buscar pendingPlan antes de atualizar
    const fullProfile = await this.prisma.userProfile.findUnique({
      where: { phoneNumber: String(chatId) },
      select: { pendingPlan: true },
    });

    // Se existe pendingPlan, usar esse plano ao invés do planCode do pagamento
    // Isso aplica o downgrade agendado no próximo ciclo
    const finalPlan = fullProfile?.pendingPlan || planCode;

    this.logger.log(
      `Applying payment - chatId: ${chatId}, paymentPlan: ${planCode}, finalPlan: ${finalPlan}, hadPendingPlan: ${!!fullProfile?.pendingPlan}`,
    );

    const expiresAt = new Date(paidAt);
    const isAnnualPlan = finalPlan === SubscriptionPlan.PLUS_ANUAL || finalPlan === SubscriptionPlan.PRO_ANUAL;
    expiresAt.setDate(expiresAt.getDate() + (isAnnualPlan ? 365 : 30));

    await this.prisma.userProfile.update({
      where: { phoneNumber: String(chatId) },
      data: {
        subscriptionPlan: finalPlan,
        isPaymentActive: true,
        lastPaymentAt: paidAt,
        subscriptionExpiresAt: expiresAt,
        nextBillingAt: expiresAt,
        pendingPlan: null, // Limpar pendingPlan após aplicar
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
  addressComplement?: string;
  phone?: string;
  mobilePhone?: string;
};
