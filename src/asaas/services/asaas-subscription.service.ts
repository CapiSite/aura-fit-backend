import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { PLAN_CHANGE_CONFIG } from '../config/plan-change.config';
import { AsaasBillingType } from '../dto/create-plan-payment.dto';
import {
  AsaasPayment,
  AsaasSubscription,
  CreditCardHolderInfoPayload,
  CreditCardPayload,
} from '../entities/asaas.types';
import { AsaasApiClient } from './asaas-api.client';
import { AsaasPaymentService, CreatePaymentInput } from './asaas-payment.service';

@Injectable()
export class AsaasSubscriptionService {
  private readonly logger = new Logger(AsaasSubscriptionService.name);

  constructor(
    private readonly apiClient: AsaasApiClient,
    private readonly prisma: PrismaService,
    private readonly paymentService: AsaasPaymentService,
  ) { }

  getPlanAmount(planCode: SubscriptionPlan): number {
    if (planCode === SubscriptionPlan.FREE) return 0;
    const pricing: Record<SubscriptionPlan, number> = {
      [SubscriptionPlan.FREE]: 0,
      [SubscriptionPlan.PLUS]: 29.9,
      [SubscriptionPlan.PRO]: 49.9,
      [SubscriptionPlan.PLUS_ANUAL]: 287.0,
      [SubscriptionPlan.PRO_ANUAL]: 479.0,
    };
    return pricing[planCode] || 0;
  }

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

  /**
   * Busca subscription do Asaas (source of truth para nextDueDate)
   */
  async getSubscription(asaasSubscriptionId: string): Promise<AsaasSubscription> {
    try {
      return await this.apiClient.request<AsaasSubscription>(
        `/subscriptions/${asaasSubscriptionId}`,
        { method: 'GET' },
      );
    } catch (error) {
      this.logger.error(`Falha ao buscar subscription ${asaasSubscriptionId}`, error);
      throw new HttpException(
        'Não foi possível consultar a assinatura',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Sincroniza data de expiração local com o nextDueDate do Asaas
   */
  async syncSubscriptionFromAsaas(asaasSubscriptionId: string): Promise<void> {
    const sub = await this.getSubscription(asaasSubscriptionId);
    const nextDueDate = this.parseAsaasDate(sub.nextDueDate);

    await this.prisma.userProfile.update({
      where: { asaasSubscriptionId },
      data: {
        subscriptionExpiresAt: nextDueDate,
        nextBillingAt: nextDueDate,
      },
    });

    this.logger.log(`Datas sincronizadas com Asaas. NextDueDate: ${sub.nextDueDate}`);
  }


  async calculatePlanChange(
    currentPlan: SubscriptionPlan,
    targetPlan: SubscriptionPlan,
    asaasSubscriptionId: string | null,
  ): Promise<{
    canChange: boolean;
    changePrice: number;
    daysRemaining: number;
    reason?: string;
    isDowngrade?: boolean;
    nextDueDate?: string;
  }> {
    const currentPrice = this.getPlanAmount(currentPlan);
    const targetPrice = this.getPlanAmount(targetPlan);
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Buscar nextDueDate do Asaas (source of truth) - SEM FALLBACK
    if (!asaasSubscriptionId) {
      throw new HttpException(
        'Assinatura não encontrada. Contate o suporte.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const sub = await this.getSubscription(asaasSubscriptionId);
    let expires = this.parseAsaasDate(sub.nextDueDate);
    const upcomingPayment = await this.paymentService.getUpcomingPaymentBySubscription(
      asaasSubscriptionId,
    );
    if (upcomingPayment?.dueDate) {
      const dueDate = this.parseAsaasDate(upcomingPayment.dueDate);
      if (dueDate.getTime() > todayUtc.getTime() && dueDate.getTime() < expires.getTime()) {
        expires = dueDate;
        this.logger.debug(`Using Asaas upcoming payment dueDate: ${upcomingPayment.dueDate}`);
      }
    }
    this.logger.debug(`Using Asaas nextDueDate: ${sub.nextDueDate}`);

    const nextDueDate = expires.toISOString().slice(0, 10);

    if (expires <= now) {
      return { canChange: true, changePrice: targetPrice, daysRemaining: 0, nextDueDate };
    }

    const diffTime = Math.abs(expires.getTime() - now.getTime());
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isDowngrade = targetPrice < currentPrice;

    if (isDowngrade) {
      return {
        canChange: true,
        changePrice: 0,
        daysRemaining,
        isDowngrade: true,
        nextDueDate,
      };
    }

    // Pro-rata upgrade
    const isCurrentAnnual = currentPlan.includes('ANUAL');
    const isTargetAnnual = targetPlan.includes('ANUAL');

    // Calcular inicio do ciclo pelo nextDueDate
    const msPerDay = 1000 * 60 * 60 * 24;
    const cycleEnd = expires;

    const computeCycleStart = (end: Date, annual: boolean): Date => {
      const endYear = end.getUTCFullYear();
      const endMonth = end.getUTCMonth();
      const endDay = end.getUTCDate();

      if (annual) {
        const targetYear = endYear - 1;
        const lastDay = new Date(Date.UTC(targetYear, endMonth + 1, 0)).getUTCDate();
        return new Date(Date.UTC(targetYear, endMonth, Math.min(endDay, lastDay)));
      }

      let targetYear = endYear;
      let targetMonth = endMonth - 1;
      if (targetMonth < 0) {
        targetMonth = 11;
        targetYear -= 1;
      }

      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      return new Date(Date.UTC(targetYear, targetMonth, Math.min(endDay, lastDay)));
    };

    const cycleStart = computeCycleStart(cycleEnd, isCurrentAnnual);

    // Calcular dias REAIS do ciclo atual (ex: 28, 30, 31 ou 365)
    const totalCycleDays = Math.max(
      1,
      Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / msPerDay)
    );

    this.logger.debug(`Cycle real: ${totalCycleDays} dias (${cycleStart.toISOString().slice(0, 10)} -> ${cycleEnd.toISOString().slice(0, 10)})`);

    // Case 1: Monthly -> Annual (Upsell / Cycle Change)
    // User is buying a FULL YEAR. We deduct the UNUSED value of the current month as credit.
    if (!isCurrentAnnual && isTargetAnnual) {
      const currentDaily = currentPrice / totalCycleDays; // Usa ciclo REAL
      const credit = currentDaily * daysRemaining;

      const annualEnd = new Date(now);
      annualEnd.setFullYear(annualEnd.getFullYear() + 1);
      const annualDays = Math.max(
        1,
        Math.ceil((annualEnd.getTime() - now.getTime()) / msPerDay),
      );

      let upgradePrice = targetPrice - credit;
      if (upgradePrice < 0) upgradePrice = 0;

      return {
        canChange: true,
        changePrice: Number(upgradePrice.toFixed(2)),
        daysRemaining: annualDays,
        isDowngrade: false,
        nextDueDate,
      };
    }

    // Case 2 (Same Cycle: Monthly->Monthly or Annual->Annual)
    // Calcular valor diário baseado no ciclo real de cada plano
    const currentDailyRate = currentPrice / totalCycleDays;
    const targetDailyRate = targetPrice / totalCycleDays;

    const diffDailyRate = targetDailyRate - currentDailyRate;
    let upgradePrice = diffDailyRate * daysRemaining;

    if (upgradePrice < 0) upgradePrice = 0;

    return {
      canChange: true,
      changePrice: Number(upgradePrice.toFixed(2)),
      daysRemaining,
      isDowngrade: false,
      nextDueDate,
    };
  }

  async getPixForSubscription(
    asaasSubscriptionId: string,
    opts?: { attempts?: number; delayMs?: number },
  ): Promise<{
    payment: AsaasPayment | null;
    pix: { encodedImage: string; payload: string; expirationDate: string } | null;
  }> {
    const attempts = Math.max(1, opts?.attempts ?? 3);
    const delayMs = Math.max(0, opts?.delayMs ?? 1000);

    let payment: AsaasPayment | null = null;
    let pix: { encodedImage: string; payload: string; expirationDate: string } | null = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      payment = await this.paymentService.getPaymentBySubscription(asaasSubscriptionId);
      if (payment?.id) {
        pix = await this.paymentService.getPixQrCode(payment.id);
        if (pix) break;
      }

      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return { payment, pix };
  }

  async createSubscription(
    planCode: SubscriptionPlan,
    customerId: string,
    opts: {
      billingType?: AsaasBillingType;
      creditCard?: CreditCardPayload;
      holderInfo?: CreditCardHolderInfoPayload;
      chatId?: string;
      nextDueDate?: string;
    },
  ): Promise<
    AsaasSubscription & {
      payment?: AsaasPayment | null;
      pix?: { encodedImage: string; payload: string; expirationDate: string } | null;
    }
  > {
    if (planCode === SubscriptionPlan.FREE) {
      this.logger.warn(`Attempt to create FREE subscription blocked`);
      throw new HttpException(
        'Plano FREE não pode ser processado como assinatura',
        HttpStatus.BAD_REQUEST,
      );
    }

    const cycle = planCode.includes('ANUAL') ? 'YEARLY' : 'MONTHLY';
    const value = this.getPlanAmount(planCode);
    const billingType = opts.billingType ?? AsaasBillingType.CREDIT_CARD;
    const nextDueDate = opts.nextDueDate ?? new Date().toISOString().slice(0, 10);


    const payload: any = {
      customer: customerId,
      billingType,
      value,
      nextDueDate,
      cycle,
      description: `Assinatura Aura Fit - ${planCode}`,
      externalReference: `SUB:${planCode}:${opts.chatId ?? ''}:${Date.now()}`,
    };

    if (billingType === AsaasBillingType.CREDIT_CARD) {
      payload.creditCard = opts.creditCard;
      payload.creditCardHolderInfo = opts.holderInfo;
    }

    this.logger.debug(
      `[AsaasSubscriptionService] Creating Subscription: ${JSON.stringify({
        ...payload,
        creditCard: payload.creditCard
          ? { ...payload.creditCard, number: '****', ccv: '***' }
          : undefined,
      })}`,
    );

    const subscription = await this.apiClient.request<AsaasSubscription>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    let payment: AsaasPayment | null | undefined;
    let pix: { encodedImage: string; payload: string; expirationDate: string } | null | undefined;
    if (billingType === AsaasBillingType.PIX) {
      const pixResult = await this.getPixForSubscription(subscription.id);
      payment = pixResult.payment;
      pix = pixResult.pix;
    }

    if (opts.chatId) {
      const nextDueDateParsed = this.parseAsaasDate(subscription.nextDueDate);

      // Atualizar outros campos do perfil antes do sync (garante asaasSubscriptionId)
      await this.prisma.userProfile.update({
        where: { phoneNumber: String(opts.chatId) },
        data: {
          asaasSubscriptionId: subscription.id,
          asaasCustomerId: customerId,
          subscriptionStatus: 'ACTIVE',
          subscriptionCycle: cycle,
          subscriptionPlan: planCode,
          isPaymentActive: true,
          lastPaymentAt: new Date(),
          subscriptionExpiresAt: nextDueDateParsed,
          nextBillingAt: nextDueDateParsed,
          pendingPlan: null,
        },
      });

      // Sincronizar datas com Asaas (source of truth)
      try {
        await this.syncSubscriptionFromAsaas(subscription.id);
      } catch (error) {
        this.logger.warn(
          `Falha ao sincronizar datas da subscription ${subscription.id} após criação.`,
          error,
        );
      }
    }

    return {
      ...subscription,
      payment,
      pix,
    };
  }

  async cancelSubscription(
    subscriptionId: string,
    chatId?: string,
  ): Promise<{ remainingDays: number; expiresAt: Date | null }> {
    if (!subscriptionId) {
      throw new HttpException('ID da assinatura não informado', HttpStatus.BAD_REQUEST);
    }

    await this.apiClient.request(`/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    });

    this.logger.log(`Subscription cancelled on Asaas - ID: ${subscriptionId}`);

    if (chatId) {
      const user = await this.prisma.userProfile.findUnique({
        where: { phoneNumber: String(chatId) },
        select: { subscriptionExpiresAt: true },
      });

      await this.prisma.userProfile.update({
        where: { phoneNumber: String(chatId) },
        data: {
          subscriptionStatus: 'INACTIVE',
          asaasSubscriptionId: null,
        },
      });

      const expiresAt = user?.subscriptionExpiresAt ?? null;
      const remainingDays = expiresAt
        ? Math.max(
          0,
          Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
        : 0;

      return { remainingDays, expiresAt };
    }

    return { remainingDays: 0, expiresAt: null };
  }

  async changeSubscriptionPlan(
    userId: number,
    targetPlan: SubscriptionPlan,
    customerId: string,
    opts: {
      paymentMethod?: AsaasBillingType;
      creditCard?: CreditCardPayload;
      holderInfo?: CreditCardHolderInfoPayload;
      chatId?: string;
    },
  ): Promise<{
    payment?: AsaasPayment;
    changeInfo: any;
    pix?: { encodedImage: string; payload: string; expirationDate: string } | null;
  }> {
    if (targetPlan === SubscriptionPlan.FREE) {
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
        asaasSubscriptionId: true,
        asaasCustomerId: true,
        phoneNumber: true,
      },
    });

    if (!user || !user.isPaymentActive || !user.subscriptionExpiresAt) {
      throw new HttpException('Nenhuma assinatura ativa para alterar', HttpStatus.BAD_REQUEST);
    }

    if (new Date(user.subscriptionExpiresAt) <= new Date()) {
      throw new HttpException('Assinatura expirada', HttpStatus.BAD_REQUEST);
    }

    const planChange = await this.calculatePlanChange(
      user.subscriptionPlan,
      targetPlan,
      user.asaasSubscriptionId,
    );

    if (!planChange.canChange) {
      throw new HttpException(
        planChange.reason || 'Mudança de plano não permitida',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (planChange.isDowngrade) {
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

    let payment: AsaasPayment | undefined;
    let pix: { encodedImage: string; payload: string; expirationDate: string } | null | undefined;

    if (planChange.changePrice >= PLAN_CHANGE_CONFIG.FREE_UPGRADE_THRESHOLD) {
      const billingType = opts.paymentMethod ?? AsaasBillingType.CREDIT_CARD;
      const description = `Upgrade de ${user.subscriptionPlan} para ${targetPlan} (${planChange.daysRemaining} dias)`;

      const payload: CreatePaymentInput = {
        customerId,
        value: planChange.changePrice,
        dueDate: new Date().toISOString().slice(0, 10),
        description,
        externalReference: `UPGRADE:${targetPlan}:${opts.chatId}:${Date.now()}`,
        creditCard: opts.creditCard,
        creditCardHolderInfo: opts.holderInfo,
        billingType,
      };

      payment = await this.paymentService.createPayment(payload);

      if (billingType === AsaasBillingType.PIX) {
        pix = await this.paymentService.getPixQrCode(payment.id);
      }

      const status = this.paymentService.getPaymentStatus(payment);
        const paidAt = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status)
          ? this.paymentService.resolvePaidAt(payment)
          : null;

      await this.paymentService.upsertPaymentRecord({
        payment,
        status,
        plan: targetPlan,
        chatId: opts.chatId || '',
        paidAt,
      });

        if (!['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status)) {
          return {
            payment,
            pix,
          changeInfo: {
            changed: false,
            scheduled: false,
            waitingPayment: true,
            isDowngrade: false,
            charged: true,
            upgradePrice: planChange.changePrice,
            daysRemaining: planChange.daysRemaining,
          },
        };
      }
    }

    if (user.asaasSubscriptionId) {
      try {
        await this.cancelSubscription(user.asaasSubscriptionId);
      } catch (e) {
        this.logger.error(`Falha ao cancelar subscription antiga ${user.asaasSubscriptionId}`, e);
      }
    }

    const nextDueDate = user.subscriptionExpiresAt.toISOString().slice(0, 10);
    const newSubscription = await this.createSubscription(targetPlan, customerId, {
      billingType: opts.paymentMethod ?? AsaasBillingType.CREDIT_CARD,
      creditCard: opts.creditCard,
      holderInfo: opts.holderInfo,
      chatId: opts.chatId,
      nextDueDate,
    });

    return {
      payment,
      pix,
      changeInfo: {
        changed: true,
        scheduled: false,
        isDowngrade: false,
        charged: !!payment,
        upgradePrice: planChange.changePrice,
        daysRemaining: planChange.daysRemaining,
        newSubscriptionId: newSubscription.id,
      },
    };
  }

  async applyConfirmedPayment(payment: AsaasPayment, status: string): Promise<boolean> {
    const { chatId, planCode } = await this.paymentService.resolvePaymentContext(payment);
    if (!chatId) return false;

    const paidAt = this.paymentService.resolvePaidAt(payment);
    const profile = await this.prisma.userProfile.findUnique({
      where: { phoneNumber: String(chatId) },
      select: {
        id: true,
        lastPaymentAt: true,
        subscriptionPlan: true,
        isPaymentActive: true,
        pendingPlan: true,
        asaasSubscriptionId: true,
        asaasCustomerId: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!profile) return false;

    await this.paymentService.upsertPaymentRecord({
      payment,
      status,
      plan: planCode,
      chatId,
      paidAt,
    });

    // Validar valor pago (exceto se for free ou upgrade pro-rata que pode ser quebrado)
    const receivedAmount = Number(payment.value ?? 0);
    const ref = (payment.externalReference || '').toString().toUpperCase();
    const isUpgrade = ref.startsWith('UPGRADE:');

    if (!isUpgrade && planCode !== SubscriptionPlan.FREE) {
      const expectedAmount = this.getPlanAmount(planCode);
      if (receivedAmount + 0.01 < expectedAmount) {
        this.logger.warn(`Pagamento abaixo do esperado (REJEITADO). paymentId=${payment.id}`);
        return false;
      }
    }

    const finalPlan = isUpgrade ? planCode : (profile.pendingPlan || planCode);
      if (isUpgrade && profile.asaasSubscriptionId && profile.asaasCustomerId) {
      if (profile.subscriptionPlan !== finalPlan) {
        this.logger.log(`Pagamento de Upgrade confirmado via Webhook/Async. Trocando assinatura no Asaas...`);
        try {
          // 1. Cancelar antiga
          await this.cancelSubscription(profile.asaasSubscriptionId);
          const currentExpires = profile.subscriptionExpiresAt ? new Date(profile.subscriptionExpiresAt) : new Date();
          const nextDueDate = currentExpires <= new Date()
            ? new Date().toISOString().slice(0, 10)
            : currentExpires.toISOString().slice(0, 10);

          const billingType = (payment.billingType as AsaasBillingType) || AsaasBillingType.CREDIT_CARD;

          const newSub = await this.createSubscription(finalPlan, profile.asaasCustomerId, {
            billingType,
            chatId: String(chatId),
            nextDueDate,
            // Nota: Se for cartão, o Asaas usa o token do customer. Não precisamos reenviar o CC aqui se o customer já tem.
          });

          this.logger.log(`Upgrade no Asaas concluído com sucesso. Nova Sub: ${newSub.id}`);

          // 🆕 Sincronizar datas com o Asaas (source of truth)
          await this.syncSubscriptionFromAsaas(newSub.id);

          // Atualizar asaasSubscriptionId no perfil com a nova subscription
          await this.prisma.userProfile.update({
            where: { phoneNumber: String(chatId) },
            data: {
              asaasSubscriptionId: newSub.id,
              subscriptionPlan: finalPlan,
              isPaymentActive: true,
              lastPaymentAt: paidAt,
              pendingPlan: null,
            },
          });

          return true; // Early return - datas já sincronizadas
        } catch (err) {
          this.logger.error(`Erro ao trocar assinatura no Asaas após pagamento de upgrade: ${err}`);
          // Não retornamos false para não travar o webhook, mas logamos erro crítico
        }
      }
    }

    // Fallback: Calcular data localmente (usado quando não há subscription no Asaas)
    const isAnnualPlan =
      finalPlan === SubscriptionPlan.PLUS_ANUAL || finalPlan === SubscriptionPlan.PRO_ANUAL;

    const standardNewExpiresAt = new Date(paidAt);

    // Usar calendário nativo (respeita 28/29/30/31 dias automaticamente)
    if (isAnnualPlan) {
      standardNewExpiresAt.setFullYear(standardNewExpiresAt.getFullYear() + 1);
    } else {
      standardNewExpiresAt.setMonth(standardNewExpiresAt.getMonth() + 1);
    }

    let newSubscriptionExpiresAt = standardNewExpiresAt;

    if (isUpgrade && profile.subscriptionExpiresAt) {
      const isCurrentAnnual = profile.subscriptionPlan.includes('ANUAL');
      const isTargetAnnual = finalPlan.includes('ANUAL');

      if (!isCurrentAnnual && isTargetAnnual) {
        // Monthly -> Annual: novo ciclo completo
        newSubscriptionExpiresAt = standardNewExpiresAt;
      } else {
        // Mesmo ciclo: mantém data original
        newSubscriptionExpiresAt = profile.subscriptionExpiresAt;

        if (newSubscriptionExpiresAt < new Date()) {
          newSubscriptionExpiresAt = standardNewExpiresAt;
        }
      }
    }

    await this.prisma.userProfile.update({
      where: { phoneNumber: String(chatId) },
      data: {
        subscriptionPlan: finalPlan,
        isPaymentActive: true,
        lastPaymentAt: paidAt,
        subscriptionExpiresAt: newSubscriptionExpiresAt,
        nextBillingAt: newSubscriptionExpiresAt,
        pendingPlan: null,
      },
    });

    return true;
  }
}
