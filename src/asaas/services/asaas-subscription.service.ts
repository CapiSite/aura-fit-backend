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

  calculatePlanChange(
    currentPlan: SubscriptionPlan,
    targetPlan: SubscriptionPlan,
    currentExpiresAt: Date,
  ): {
    canChange: boolean;
    changePrice: number;
    daysRemaining: number;
    reason?: string;
    isDowngrade?: boolean;
  } {
    const currentPrice = this.getPlanAmount(currentPlan);
    const targetPrice = this.getPlanAmount(targetPlan);
    const now = new Date();
    const expires = new Date(currentExpiresAt);

    if (expires <= now) {
      return { canChange: true, changePrice: targetPrice, daysRemaining: 30 };
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
      };
    }

    // Pro-rata upgrade
    const currentDailyRate = currentPrice / 30; // Simplificado
    const targetDailyRate = targetPrice / 30;
    const diffDailyRate = targetDailyRate - currentDailyRate;
    let upgradePrice = diffDailyRate * daysRemaining;

    if (upgradePrice < 0) upgradePrice = 0;

    return {
      canChange: true,
      changePrice: Number(upgradePrice.toFixed(2)),
      daysRemaining,
      isDowngrade: false,
    };
  }

  private calculateExpiresAt(cycle: string): Date {
    const expiresAt = new Date();
    if (cycle === 'YEARLY') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }
    return expiresAt;
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
  ): Promise<AsaasSubscription> {
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

    if (billingType !== AsaasBillingType.PIX) {
      // Basic validation handled by DTOs in Controller usually, but good to have here
      if (!opts.creditCard || !opts.holderInfo) {
        throw new HttpException('Dados do cartão obrigatórios', HttpStatus.BAD_REQUEST);
      }
    }

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

    if (opts.chatId) {
      const expiresAt = this.calculateExpiresAt(cycle);
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
          subscriptionExpiresAt: expiresAt,
          nextBillingAt: expiresAt,
          pendingPlan: null,
        },
      });
    }

    return subscription;
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
  ): Promise<{ payment?: AsaasPayment; changeInfo: any }> {
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

      await this.paymentService.upsertPaymentRecord({
        payment,
        status: this.paymentService.getPaymentStatus(payment),
        plan: targetPlan,
        chatId: opts.chatId || '',
        paidAt: null,
      });

      const status = this.paymentService.getPaymentStatus(payment);
      if (!['CONFIRMED', 'RECEIVED'].includes(status)) {
        if (['CONFIRMED', 'RECEIVED'].includes(status)) {
          await this.applyConfirmedPayment(payment, status);
        } else {
          return {
            payment,
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
      } else {
        await this.applyConfirmedPayment(payment, status);
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
        } catch (err) {
          this.logger.error(`Erro ao trocar assinatura no Asaas após pagamento de upgrade: ${err}`);
          // Não retornamos false para não travar o webhook, mas logamos erro crítico
        }
      }
    }

    // Atualizar perfil local
    const expiresAt = new Date(paidAt);
    const isAnnualPlan =
      finalPlan === SubscriptionPlan.PLUS_ANUAL || finalPlan === SubscriptionPlan.PRO_ANUAL;
    expiresAt.setDate(expiresAt.getDate() + (isAnnualPlan ? 365 : 30));

    let newSubscriptionExpiresAt = expiresAt;

    if (isUpgrade && profile.subscriptionExpiresAt) {
      newSubscriptionExpiresAt = profile.subscriptionExpiresAt;

      // Se estava expirada, aí sim renova?
      if (newSubscriptionExpiresAt < new Date()) {
        newSubscriptionExpiresAt = expiresAt; // Começa ciclo novo completo
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
