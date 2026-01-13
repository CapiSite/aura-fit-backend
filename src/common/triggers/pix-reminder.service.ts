import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { ReminderService } from './reminder.service';

@Injectable()
export class PixReminderService {
  private readonly logger = new Logger(PixReminderService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderService: ReminderService,
  ) { }

  @Cron('0 10 * * *', {
    name: 'pix-payment-reminder',
    timeZone: 'America/Sao_Paulo',
  })
  async handlePixReminders() {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 2);
    rangeEnd.setHours(23, 59, 59, 999);

    const payments = await this.prisma.payment.findMany({
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
    if (!payments.length) {
      return;
    }

    for (const payment of payments) {
      const phoneNumber = payment.user?.phoneNumber;
      if (!phoneNumber) continue;

      if (payment.pixReminderLastSentAt) {
        const sentKey = payment.pixReminderLastSentAt.toISOString().slice(0, 10);
        if (sentKey === todayKey) continue;
      }

      const dueLabel = payment.dueDate
        ? payment.dueDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : 'hoje';
      const amountLabel = `R$ ${Number(payment.amount ?? 0).toFixed(2).replace('.', ',')}`;
      const planLabel = String(payment.plan ?? '').replace(/_/g, ' ');
      const greeting = payment.user?.name ? `Oi ${payment.user.name},` : 'Oi,';
      const message =
        `${greeting} seu pagamento PIX do plano ${planLabel} vence em ${dueLabel}. ` +
        `Valor: ${amountLabel}. Acesse o site em Faturas para gerar o QR Code.   LINK: https://aurafit.ia.br/dashboard`;

      try {
        await this.reminderService.sendCustomMessage(phoneNumber, message, {
          transportName: 'WhatsApp',
        });
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { pixReminderLastSentAt: now },
        });
      } catch (error) {
        this.logger.warn(`Falha ao enviar lembrete PIX para ${phoneNumber}`, error as Error);
      }
    }
  }
}
