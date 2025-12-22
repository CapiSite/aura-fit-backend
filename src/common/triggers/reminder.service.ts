import { Injectable, Logger } from '@nestjs/common';
import { ReminderTransport } from './reminder-transport.interface';
import { UsersService } from '../../users/users.service';
import { PrismaService } from '../../prisma_connection/prisma.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly transports: ReminderTransport[] = [];
  private readonly checkIntervalMs = 15 * 60 * 1000; // verifica a cada 15 minutos
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
      // ✅ QUERY OTIMIZADA: Só busca usuários elegíveis E ATIVOS
      const users = await this.prisma.userProfile.findMany({
        where: {
          waterReminderEnabled: true,
          waterReminderIntervalMinutes: { not: null },
          // ✅ Apenas usuários com assinatura ativa
          OR: [
            { subscriptionExpiresAt: { gt: now } }, // Assinatura válida
            { isPaymentActive: true }, // Ou pagamento ativo
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

      for (const user of users) {
        const intervalMinutes = user.waterReminderIntervalMinutes!;
        const lastSent = user.waterReminderLastSent
          ? new Date(user.waterReminderLastSent)
          : null;

        const intervalMs = intervalMinutes * 60 * 1000;
        if (lastSent && now.getTime() - lastSent.getTime() < intervalMs) {
          continue; // Ainda não chegou a hora
        }

        const phoneNumber = user.phoneNumber;
        if (!phoneNumber) continue; // Pula se não tem telefone

        for (const transport of this.transports) {
          try {
            await transport.send(phoneNumber, message);
          } catch (error) {
            this.logger.warn(
              `Failed to send water reminder via ${transport.name} to ${phoneNumber}`,
              error as Error,
            );
          }
        }

        // Atualiza o último envio no banco
        try {
          await this.prisma.userProfile.update({
            where: { id: user.id },
            data: { waterReminderLastSent: now },
          });
        } catch (error) {
          this.logger.warn(
            `Failed to update waterReminderLastSent for ${phoneNumber}`,
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