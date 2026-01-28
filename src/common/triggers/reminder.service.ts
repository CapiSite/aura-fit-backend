import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { TimezoneService } from '../services/timezone.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly transports: ReminderTransport[] = [];

  // Configurações
  private readonly ACTIVE_HOURS_START = 6;
  private readonly ACTIVE_HOURS_END = 23;
  private readonly BATCH_SIZE = 50;
  private readonly DELAY_BETWEEN_BATCHES_MS = 1000;

  private readonly messages = [
    'Bora beber água? Sua meta agradece!💧',
    'Seu corpo pediu água. Seu eu do futuro agradece.💧',
    'Se a vida está corrida, pelo menos a água não pode faltar.💧',
    'Um gole hoje, zero dor de cabeça amanhã.💧',
    'Recarrega aí: água é a bateria do corpo.💧',
    'Água agora. A melhor decisão que você vai tomar em 3 segundos.💧',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {
    this.logger.log('ReminderService initialized with cron scheduler (Event-Driven)');
  }

  registerTransport(transport: ReminderTransport): void {
    this.transports.push(transport);
    this.logger.log(`Reminder transport registered: ${transport.name}`);
  }

  async sendCustomMessage(
    phoneNumber: string,
    message: string,
    opts?: { transportName?: string },
  ): Promise<void> {
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
  async handleWaterRemindersCron(): Promise<void> {
    const now = new Date();

    if (!this.isWithinActiveWindow(now)) {
      return;
    }

    if (!this.transports.length) {
      this.logger.warn('No reminder transports registered; skipping water reminders.');
      return;
    }

    try {
      const dueUsers = await this.prisma.userProfile.findMany({
        where: {
          waterReminderEnabled: true,
          waterReminderIntervalMinutes: { not: null },
          subscriptionExpiresAt: { gt: now },
          isActive: true,
          nextWaterReminderAt: { lte: now },
        },
        take: 100, // Lote para self-healing gradual
        orderBy: { nextWaterReminderAt: 'asc' },
        select: {
          id: true,
          phoneNumber: true,
          waterReminderIntervalMinutes: true,
          waterReminderLastSent: true,
          nextWaterReminderAt: true
        },
      });

      const availableSlots = 100 - dueUsers.length;
      let users = dueUsers;

      // 2. Self-healing: inicializa apenas uma pequena amostra de NULL quando ha capacidade
      if (availableSlots > 0) {
        const selfHealUsers = await this.prisma.userProfile.findMany({
          where: {
            waterReminderEnabled: true,
            waterReminderIntervalMinutes: { not: null },
            subscriptionExpiresAt: { gt: now },
            isActive: true,
            nextWaterReminderAt: null
          },
          take: Math.min(availableSlots, 20),
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            phoneNumber: true,
            waterReminderIntervalMinutes: true,
            waterReminderLastSent: true,
            nextWaterReminderAt: true
          },
        });

        users = users.concat(selfHealUsers);
      }

      if (users.length === 0) {
        return;
      }

      const message = this.pickMessage();
      await this.processBatches(users, now, message);
    } catch (error) {
      this.logger.error('Failed to send water reminders', error as Error);
    }
  }

  private isWithinActiveWindow(now: Date = new Date()): boolean {
    return this.timezoneService.isWithinHourRange(
      this.ACTIVE_HOURS_START,
      this.ACTIVE_HOURS_END,
      now,
    );
  }

  private async processBatches(
    users: Array<{
      id: number;
      phoneNumber: string;
      waterReminderIntervalMinutes: number | null;
      waterReminderLastSent: Date | null;
      nextWaterReminderAt: Date | null;
    }>,
    now: Date,
    message: string,
  ): Promise<void> {
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < users.length; i += this.BATCH_SIZE) {
      const batch = users.slice(i, i + this.BATCH_SIZE);

      const sendPromises = batch.map(async (user) => {
        const intervalMinutes = user.waterReminderIntervalMinutes!;
        const lastSent = user.waterReminderLastSent
          ? new Date(user.waterReminderLastSent)
          : null;
        const intervalMs = intervalMinutes * 60 * 1000;

        let sent = false;
        let shouldSend = true;

        if (!user.nextWaterReminderAt && lastSent) {
          const timeSinceLast = now.getTime() - lastSent.getTime();
          if (timeSinceLast < intervalMs) {
            shouldSend = false;
          }
        }

        const phoneNumber = user.phoneNumber;
        if (shouldSend && phoneNumber) {
          try {
            for (const transport of this.transports) {
              await transport.send(phoneNumber, message);
            }
            sent = true;
            sentCount++;
          } catch (error) {
            this.logger.warn(`Failed to send water reminder to ${phoneNumber}`, error as Error);
            failedCount++;
          }
        }

        let nextDate = new Date(now.getTime() + intervalMs);

        if (!sent && !user.nextWaterReminderAt && lastSent) {
          nextDate = new Date(lastSent.getTime() + intervalMs);
          if (nextDate < now) nextDate = new Date(now.getTime() + intervalMs);
        }

        await this.prisma.userProfile.update({
          where: { id: user.id },
          data: {
            waterReminderLastSent: sent ? now : undefined,
            nextWaterReminderAt: nextDate
          }
        });

      });

      await Promise.allSettled(sendPromises);

      if (i + this.BATCH_SIZE < users.length) {
        await this.sleep(this.DELAY_BETWEEN_BATCHES_MS);
      }
    }

    this.logger.log(
      `Water reminders complete: Sent=${sentCount}, Failed=${failedCount}, Total=${users.length}`,
    );
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.messages.length);
    return this.messages[idx] ?? this.messages[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
