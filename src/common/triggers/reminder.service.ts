import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from 'src/prisma_connection/prisma.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly transports: ReminderTransport[] = [];
  private readonly checkIntervalMs = 5 * 60 * 1000; // verifica a cada 5 minutos
  private readonly activeHours = { start: 6, end: 23 }; // janela diária
  private readonly messages = [
    'Bora beber água antes que a sede vire drama.',
    'Seu corpo pediu: água. Seu eu futuro agradece.',
    'Se a vida tá corrida, pelo menos a água não pode faltar.',
    'Um gole hoje, zero dor de cabeça amanhã.',
    'Recarrega aí: água é bateria do corpo.',
    'Água agora. A sua melhor decisão em 3 segundos.'
  ];
  private reminderTimer?: NodeJS.Timeout;

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {
    this.startScheduler();
  }

  registerTransport(transport: ReminderTransport) {
    this.transports.push(transport);
    this.logger.log(`Reminder transport registered: ${transport.name}`);
  }

  private startScheduler() {
    // dispara de imediato e depois a cada intervalo
    void this.sendWaterReminders();
    this.reminderTimer = setInterval(
      () => void this.sendWaterReminders(),
      this.checkIntervalMs,
    );
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
      const users = (await this.usersService.findAll()) as any[];
      const message = this.pickMessage();

      for (const user of users) {
        const enabled = user?.waterReminderEnabled ?? true;
        const intervalMinutes = user?.waterReminderIntervalMinutes ?? 180;
        const lastSent = user?.waterReminderLastSent
          ? new Date(user.waterReminderLastSent)
          : null;

        if (!enabled || intervalMinutes <= 0) continue;

        const intervalMs = intervalMinutes * 60 * 1000;
        if (lastSent && now.getTime() - lastSent.getTime() < intervalMs) {
          continue;
        }

        const chatId = user?.chatId ?? '';
        if (!chatId) continue;

        for (const transport of this.transports) {
          try {
            await transport.send(chatId, message);
          } catch (error) {
            this.logger.warn(
              `Failed to send water reminder via ${transport.name} to ${chatId}`,
              error as Error,
            );
          }
        }

        // Atualiza o último envio no banco
        try {
          await this.prisma.userProfile.update({
            where: { chatId },
            data: { waterReminderLastSent: now },
          });
        } catch (error) {
          this.logger.warn(
            `Failed to update waterReminderLastSent for ${chatId}`,
            error as Error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to send water reminders', error as Error);
    }
  }

  private pickMessage() {
    const idx = Math.floor(Math.random() * this.messages.length);
    return this.messages[idx] ?? this.messages[0];
  }
}
