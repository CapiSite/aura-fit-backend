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

    const event = body.event;

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

    // 2. Handle Payment Events
    const payment = 'payment' in body ? body.payment : body;
    if (!payment) return { ok: false };

    const status = this.paymentService.getPaymentStatus(payment);
    if (!['CONFIRMED', 'RECEIVED'].includes(status)) {
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
        const cycle = user.subscriptionCycle || 'MONTHLY';
        const paidAt = this.paymentService.resolvePaidAt(payment);
        const newExpiresAt = new Date(paidAt);

        if (cycle === 'YEARLY') {
          newExpiresAt.setFullYear(newExpiresAt.getFullYear() + 1);
        } else {
          newExpiresAt.setMonth(newExpiresAt.getMonth() + 1);
        }

        await this.prisma.userProfile.update({
          where: { id: user.id },
          data: {
            isPaymentActive: true,
            subscriptionStatus: 'ACTIVE',
            lastPaymentAt: paidAt,
            subscriptionExpiresAt: newExpiresAt,
            nextBillingAt: newExpiresAt,
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
