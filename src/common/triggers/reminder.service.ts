import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { UsersService } from '../../users/users.service';
import { PrismaService } from '../../prisma_connection/prisma.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly transports: ReminderTransport[] = [];
  private readonly activeHours = { start: 6, end: 23 };
  private readonly messages = [
    'Bora beber água antes que a sede vire drama.',
    'Seu corpo pediu: água. Seu eu futuro agradece.',
    'Se a vida tá corrida, pelo menos a água não pode faltar.',
    'Um gole hoje, zero dor de cabeça amanhã.',
    'Recarrega aí: água é bateria do corpo.',
    'Água agora. A sua melhor decisão em 3 segundos.'
  ];

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('ReminderService initialized with cron scheduler');
  }

  registerTransport(transport: ReminderTransport) {
    this.transports.push(transport);
    this.logger.log(`Reminder transport registered: ${transport.name}`);
  }

  async sendCustomMessage(
    phoneNumber: string,
    message: string,
    opts?: { transportName?: string },
  ) {
    if (!this.transports.length) {
      this.logger.warn('No reminder transports registered; skipping custom message.');
      return;
    }

    const targets = opts?.transportName
      ? this.transports.filter((transport) => transport.name === opts.transportName)
      : this.transports;

    if (!targets.length) {
      this.logger.warn(`No reminder transports matched: ${opts?.transportName ?? 'ALL'}`);
      return;
    }

    for (const transport of targets) {
      await transport.send(phoneNumber, message);
    }
  }

  @Cron('*/15 * * * *', {
    name: 'water-reminder-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleWaterRemindersCron() {
    await this.sendWaterReminders();
  }

  private isWithinActiveWindow(now: Date) {
    const hour = now.getHours();
    return hour >= this.activeHours.start && hour <= this.activeHours.end;
  }

  private async sendWaterReminders() {
    const now = new Date();
    if (!this.isWithinActiveWindow(now)) {
      return;
    }

    if (!this.transports.length) {
      this.logger.warn('No reminder transports registered; skipping water reminders.');
      return;
    }

    try {
      const users = await this.prisma.userProfile.findMany({
        where: {
          waterReminderEnabled: true,
          waterReminderIntervalMinutes: { not: null },
          OR: [
            { subscriptionExpiresAt: { gt: now } },
            { isPaymentActive: true },
          ],
        },
        select: {
          id: true,
          phoneNumber: true,
          waterReminderIntervalMinutes: true,
          waterReminderLastSent: true,
        },
      });

      if (users.length === 0) {
        this.logger.debug('No users with water reminders enabled');
        return;
      }

      const message = this.pickMessage();

      // Batch processing
      const BATCH_SIZE = 50;
      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        const sendPromises = batch.map(async (user) => {
          const intervalMinutes = user.waterReminderIntervalMinutes!;
          const lastSent = user.waterReminderLastSent
            ? new Date(user.waterReminderLastSent)
            : null;

          const intervalMs = intervalMinutes * 60 * 1000;
          if (lastSent && now.getTime() - lastSent.getTime() < intervalMs) {
            return;
          }

          const phoneNumber = user.phoneNumber;
          if (!phoneNumber) return;

          try {
            for (const transport of this.transports) {
              await transport.send(phoneNumber, message);
            }

            await this.prisma.userProfile.update({
              where: { id: user.id },
              data: { waterReminderLastSent: now },
            });

            sentCount++;
          } catch (error) {
            this.logger.warn(
              `Failed to send water reminder to ${phoneNumber}`,
              error as Error,
            );
            failedCount++;
          }
        });

        // Processa batch
        await Promise.allSettled(sendPromises);

        // Delay entre batches
        if (i + BATCH_SIZE < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      this.logger.log(
        `Water reminders complete: Sent=${sentCount}, Failed=${failedCount}, Total=${users.length}`
      );
    } catch (error) {
      this.logger.error('Failed to send water reminders', error as Error);
    }
  }

  private pickMessage() {
    const idx = Math.floor(Math.random() * this.messages.length);
    return this.messages[idx] ?? this.messages[0];
  }
}
