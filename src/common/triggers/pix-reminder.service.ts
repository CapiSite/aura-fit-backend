import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { ReminderService } from './reminder.service';

const PIX_PAYMENT_SELECT = {
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
} as const;

type PixPayment = Prisma.PaymentGetPayload<{ select: typeof PIX_PAYMENT_SELECT }>;

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
      let cursorId: number | undefined;
      let total = 0;
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      let batchNumber = 0;

      while (true) {
        const payments = await this.findPendingPayments(
          todayStart,
          rangeEnd,
          cursorId,
          this.BATCH_SIZE,
        );

        if (!payments.length) {
          if (batchNumber === 0) {
            this.logger.debug('No pending PIX payments found');
          }
          break;
        }

        batchNumber++;
        this.logger.log(`Processing batch ${batchNumber}`);

        const batchResult = await this.processBatch(payments, todayKey, now);
        total += payments.length;
        sent += batchResult.sent;
        failed += batchResult.failed;
        skipped += batchResult.skipped;

        cursorId = payments[payments.length - 1].id;

        if (payments.length < this.BATCH_SIZE) {
          break;
        }

        await this.sleep(this.DELAY_BETWEEN_BATCHES_MS);
      }

      if (total > 0) {
        this.logger.log(
          `PIX reminders complete: Sent=${sent}, Failed=${failed}, Skipped=${skipped}, Total=${total}`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to send PIX reminders', error as Error);
    }
  }

  private async findPendingPayments(
    todayStart: Date,
    rangeEnd: Date,
    cursorId?: number,
    take = this.BATCH_SIZE,
  ): Promise<PixPayment[]> {
    const where: Prisma.PaymentWhereInput = {
      method: 'PIX',
      status: { in: ['PENDING', 'OVERDUE'] },
      dueDate: { lte: rangeEnd },
      OR: [
        { pixReminderLastSentAt: null },
        { pixReminderLastSentAt: { lt: todayStart } },
      ],
    };

    if (cursorId) {
      return this.prisma.payment.findMany({
        where,
        orderBy: { id: 'asc' },
        take,
        cursor: { id: cursorId },
        skip: 1,
        select: PIX_PAYMENT_SELECT,
      });
    }

    return this.prisma.payment.findMany({
      where,
      orderBy: { id: 'asc' },
      take,
      select: PIX_PAYMENT_SELECT,
    });
  }

  private async processBatch(
    payments: PixPayment[],
    todayKey: string,
    now: Date,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const payment of payments) {
      const phoneNumber = payment.user?.phoneNumber;
      if (!phoneNumber) {
        skippedCount++;
        continue;
      }

      // Verifica se ja enviou hoje
      if (payment.pixReminderLastSentAt) {
        const sentKey = this.getTodayKey(payment.pixReminderLastSentAt);
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

    return { sent: sentCount, failed: failedCount, skipped: skippedCount };
  }

  private buildPaymentMessage(payment: PixPayment): string {
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

  private getSaoPauloDateParts(date: Date): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = Number(parts.find((p) => p.type == 'year')?.value ?? 0);
    const month = Number(parts.find((p) => p.type == 'month')?.value ?? 1);
    const day = Number(parts.find((p) => p.type == 'day')?.value ?? 1);

    return { year, month, day };
  }

  private buildSaoPauloDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    ms: number,
  ): Date {
    return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, second, ms));
  }

  private getTodayKey(now: Date): string {
    const { year, month, day } = this.getSaoPauloDateParts(now);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private getStartOfDay(date: Date): Date {
    const { year, month, day } = this.getSaoPauloDateParts(date);
    return this.buildSaoPauloDate(year, month, day, 0, 0, 0, 0);
  }

  private getEndOfDaysPlusN(date: Date, days: number): Date {
    const start = this.getStartOfDay(date);
    return new Date(start.getTime() + (days + 1) * 24 * 60 * 60 * 1000 - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
