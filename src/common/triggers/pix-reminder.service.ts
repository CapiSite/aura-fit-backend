import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { ReminderService } from './reminder.service';

@Injectable()
export class PixReminderService {
  private readonly logger = new Logger(PixReminderService.name);

  // Configurações
  private readonly BATCH_SIZE = 50;
  private readonly DAYS_AHEAD_TO_CHECK = 2;
  private readonly DELAY_BETWEEN_BATCHES_MS = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderService: ReminderService,
  ) {
    this.logger.log('PixReminderService initialized with cron scheduler');
  }

  /**
   * Cron job que executa diariamente às 10h para enviar lembretes de pagamento PIX
   * Verifica pagamentos pendentes ou atrasados que vencem nos próximos 2 dias
   */
  @Cron('0 10 * * *', {
    name: 'pix-payment-reminder',
    timeZone: 'America/Sao_Paulo',
  })
  async handlePixReminders(): Promise<void> {
    const now = new Date();
    const todayKey = this.getTodayKey(now);
    const todayStart = this.getStartOfDay(now);
    const rangeEnd = this.getEndOfDaysPlusN(now, this.DAYS_AHEAD_TO_CHECK);

    try {
      const payments = await this.findPendingPayments(todayStart, rangeEnd);

      if (!payments.length) {
        this.logger.debug('No pending PIX payments found');
        return;
      }

      this.logger.log(`Found ${payments.length} pending PIX payments`);

      await this.processBatches(payments, todayKey, now);
    } catch (error) {
      this.logger.error('Failed to send PIX reminders', error as Error);
    }
  }

  private async findPendingPayments(todayStart: Date, rangeEnd: Date) {
    return this.prisma.payment.findMany({
      where: {
        method: 'PIX',
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lte: rangeEnd },
        OR: [
          { pixReminderLastSentAt: null },
          { pixReminderLastSentAt: { lt: todayStart } },
        ],
      },
      select: {
        id: true,
        amount: true,
        plan: true,
        dueDate: true,
        pixReminderLastSentAt: true,
        user: {
          select: {
            phoneNumber: true,
            name: true,
          },
        },
      },
    });
  }

  private async processBatches(
    payments: Array<{
      id: number;
      amount: number | null;
      plan: any;
      dueDate: Date | null;
      pixReminderLastSentAt: Date | null;
      user: { phoneNumber: string; name: string | null } | null;
    }>,
    todayKey: string,
    now: Date,
  ): Promise<void> {
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < payments.length; i += this.BATCH_SIZE) {
      const batch = payments.slice(i, i + this.BATCH_SIZE);
      const batchNumber = Math.floor(i / this.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(payments.length / this.BATCH_SIZE);

      this.logger.log(`Processing batch ${batchNumber}/${totalBatches}`);

      for (const payment of batch) {
        const phoneNumber = payment.user?.phoneNumber;
        if (!phoneNumber) {
          skippedCount++;
          continue;
        }

        // Verifica se já enviou hoje
        if (payment.pixReminderLastSentAt) {
          const sentKey = payment.pixReminderLastSentAt.toISOString().slice(0, 10);
          if (sentKey === todayKey) {
            skippedCount++;
            continue;
          }
        }

        const message = this.buildPaymentMessage(payment);

        try {
          await this.reminderService.sendCustomMessage(phoneNumber, message, {
            transportName: 'WhatsApp',
          });

          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { pixReminderLastSentAt: now },
          });

          sentCount++;
          this.logger.debug(`PIX reminder sent to ${phoneNumber}`);
        } catch (error) {
          this.logger.warn(`Failed to send PIX reminder to ${phoneNumber}`, error as Error);
          failedCount++;
        }
      }

      // Delay entre batches
      if (i + this.BATCH_SIZE < payments.length) {
        await this.sleep(this.DELAY_BETWEEN_BATCHES_MS);
      }
    }

    this.logger.log(
      `PIX reminders complete: Sent=${sentCount}, Failed=${failedCount}, Skipped=${skippedCount}, Total=${payments.length}`,
    );
  }

  private buildPaymentMessage(payment: {
    amount: number | null;
    plan: any;
    dueDate: Date | null;
    user: { name: string | null } | null;
  }): string {
    const dueLabel = payment.dueDate
      ? payment.dueDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'hoje';
    const amountLabel = `R$ ${Number(payment.amount ?? 0).toFixed(2).replace('.', ',')}`;
    const planLabel = String(payment.plan ?? '').replace(/_/g, ' ');
    const greeting = payment.user?.name ? `Oi ${payment.user.name},` : 'Oi,';

    return (
      `${greeting} seu pagamento PIX do plano ${planLabel} vence em ${dueLabel}. ` +
      `Valor: ${amountLabel}. Acesse o site em Faturas para gerar o QR Code. LINK: https://aurafit.ia.br/dashboard`
    );
  }

  private getTodayKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private getStartOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private getEndOfDaysPlusN(date: Date, days: number): Date {
    const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    endDate.setDate(endDate.getDate() + days);
    endDate.setHours(23, 59, 59, 999);
    return endDate;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
