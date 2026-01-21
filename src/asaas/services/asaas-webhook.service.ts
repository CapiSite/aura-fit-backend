import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { AsaasPayment, AsaasWebhookPayload } from '../entities/asaas.types';
import { AsaasPaymentService } from './asaas-payment.service';
import { AsaasSubscriptionService } from './asaas-subscription.service';

@Injectable()
export class AsaasWebhookService {
  private readonly logger = new Logger(AsaasWebhookService.name);
  private readonly webhookToken: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly paymentService: AsaasPaymentService,
    private readonly subscriptionService: AsaasSubscriptionService,
  ) {
    this.webhookToken = this.configService.get<string>('ASAAS_WEBHOOK_TOKEN') ?? '';
  }

  async handleWebhook(body: AsaasWebhookPayload | any, token?: string) {
    if (this.webhookToken && token !== this.webhookToken) {
      throw new HttpException('Unauthorized webhook', HttpStatus.UNAUTHORIZED);
    }

    if (!body) {
      this.logger.warn('Webhook received empty body');
      return { ok: false };
    }

    const event = body.event;
    if (!event) {
      this.logger.warn('Webhook received without event');
      return { ok: false };
    }

    // 1. Handle Subscription Deletion
    if (event === 'SUBSCRIPTION_DELETED') {
      const sub = body.subscription;
      if (sub?.id) {
        this.logger.log(`Webhook: Subscription Deleted - ID: ${sub.id}`);
        await this.prisma.userProfile.updateMany({
          where: { asaasSubscriptionId: sub.id },
          data: { subscriptionStatus: 'INACTIVE', asaasSubscriptionId: null },
        });
        return { ok: true, type: 'subscription_deleted' };
      }
    }

    const isPaymentEvent = typeof event === 'string' && event.startsWith('PAYMENT_');
    if (!isPaymentEvent) {
      this.logger.debug(`Webhook ignored event: ${event}`);
      return { ok: true, ignored: true };
    }

    // 2. Handle Payment Events
    const payment = 'payment' in body ? body.payment : body;
    if (!payment?.id) {
      this.logger.warn(`Webhook payment event without payment payload: ${event}`);
      return { ok: false };
    }

    const status = this.paymentService.getPaymentStatus(payment);
    const billingType = (payment?.billingType ?? '').toString().toUpperCase();
    this.logger.debug(
      `Webhook payment received: event=${event} id=${payment?.id ?? '-'} status=${status} billingType=${billingType}`,
    );
    const isConfirmed = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status);

    if (!isConfirmed) {
      const isPix = billingType === 'PIX';
      const shouldPersist = isPix && ['PENDING', 'OVERDUE'].includes(status);
      if (shouldPersist) {
        this.logger.debug(
          `Webhook PIX pending persisted: id=${payment?.id ?? '-'} status=${status}`,
        );
        let user =
          payment.subscription
            ? await this.prisma.userProfile.findFirst({
              where: { asaasSubscriptionId: payment.subscription },
            })
            : null;

        if (!user && payment.customer) {
          user = await this.prisma.userProfile.findUnique({
            where: { asaasCustomerId: payment.customer },
          });
        }

        if (user) {
          await this.paymentService.upsertPaymentRecord({
            payment,
            status,
            plan: user.subscriptionPlan,
            chatId: user.phoneNumber,
            paidAt: null,
          });
          return { ok: true, pending: true };
        }
      }

      return { ok: true, ignored: true };
    }

    if (payment.subscription) {
      this.logger.log(
        `Webhook: Subscription Payment Confirmed - SubID: ${payment.subscription}, PayID: ${payment.id}`,
      );

      const user = await this.prisma.userProfile.findFirst({
        where: { asaasSubscriptionId: payment.subscription },
      });

      if (user) {
        const paidAt = this.paymentService.resolvePaidAt(payment);

        // Sincronizar datas com Asaas (source of truth)
        try {
          await this.subscriptionService.syncSubscriptionFromAsaas(payment.subscription);
        } catch (error) {
          this.logger.error(`Falha ao sincronizar subscription do Asaas: ${error}`);
          // Fallback: calcular localmente apenas se sync falhar
          const cycle = user.subscriptionCycle || 'MONTHLY';
          const newExpiresAt = new Date(paidAt);

          if (cycle === 'YEARLY') {
            newExpiresAt.setFullYear(newExpiresAt.getFullYear() + 1);
          } else {
            newExpiresAt.setMonth(newExpiresAt.getMonth() + 1);
          }

          await this.prisma.userProfile.update({
            where: { id: user.id },
            data: {
              subscriptionExpiresAt: newExpiresAt,
              nextBillingAt: newExpiresAt,
            },
          });
        }

        // Atualizar status de pagamento
        await this.prisma.userProfile.update({
          where: { id: user.id },
          data: {
            isPaymentActive: true,
            subscriptionStatus: 'ACTIVE',
            lastPaymentAt: paidAt,
          },
        });

        await this.paymentService.upsertPaymentRecord({
          payment,
          status,
          plan: user.subscriptionPlan,
          chatId: user.phoneNumber,
          paidAt,
        });

        return { ok: true, type: 'subscription_renewed', user: user.cpf };
      } else {
        this.logger.warn(
          `Webhook: Subscription payment for unknown subscriptionId: ${payment.subscription}`,
        );
        if (payment.customer) {
          const userByCustomer = await this.prisma.userProfile.findUnique({
            where: { asaasCustomerId: payment.customer },
          });
          if (userByCustomer) {
            await this.prisma.userProfile.update({
              where: { id: userByCustomer.id },
              data: { asaasSubscriptionId: payment.subscription },
            });
            return this.handleWebhook(body, token);
          }
        }
      }
    }

    const updated = await this.subscriptionService.applyConfirmedPayment(payment, status);
    return { ok: true, updated };
  }
}
