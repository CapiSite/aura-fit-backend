import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';

@Injectable()
export class MorningGreetingService {
  private readonly logger = new Logger(MorningGreetingService.name);
  private readonly transports: ReminderTransport[] = [];

  // Configurações
  private readonly CHECK_WINDOW_START_HOUR = 5;
  private readonly CHECK_WINDOW_END_HOUR = 11;
  private readonly GREETING_WINDOW_DURATION_MINUTES = 30;
  private readonly DEFAULT_WAKE_HOUR = 6;
  private readonly DEFAULT_WAKE_MINUTE = 0;
  private readonly BATCH_SIZE = 50;
  private readonly CONCURRENT_SENDS = 5;
  private readonly MAX_DELAY_BETWEEN_BATCHES_MS = 2000;
  private readonly DELAY_PER_USER_MS = 50;

  private readonly morningMessages = [
    '☀️ Bom dia! Vamos acordar e começar o dia com o pé direito! Como consigo te ajudar hoje?',
    '🌅 Bom dia! Hora de acordar e arrasar! O que você planeja conquistar hoje?',
    '💪 Bom dia! Um novo dia cheio de oportunidades! Como posso te apoiar hoje?',
    '✨ Bom dia! Levanta que o sucesso te espera! Vamos começar bem? Como posso ajudar?',
    '🔥 Bom dia! Acorda campeão(ã)! Mais um dia para ser a melhor versão de si! Em que posso ajudar?',
    '🌟 Bom dia! O dia promete, vamos aproveitar! Como posso te auxiliar hoje?',
    '⚡ Bom dia! Energia positiva para começar o dia! Vamos lá, como posso te ajudar?',
    '🎯 Bom dia! Foco e determinação! Mais um dia para alcançar seus objetivos! Posso ajudar em algo?',
  ];

  // Rastreamento de envios por dia
  private sentGreetingsToday = new Set<string>();
  private lastCheckDate: string | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.logger.log('MorningGreetingService initialized with cron scheduler');
  }

  registerTransport(transport: ReminderTransport): void {
    this.transports.push(transport);
    this.logger.log(`Morning greeting transport registered: ${transport.name}`);
  }

  /**
   * Cron job que executa a cada 5 minutos para enviar saudações matinais
   * Verifica janela de 30min baseada no wakeTime de cada usuário
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'morning-greeting-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleMorningGreetingCron(): Promise<void> {
    await this.sendMorningGreetings();
  }

  private getCurrentDateKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private getScheduledWindowForUser(
    userId: number,
    dateKey: string,
    wakeTime: string | null,
  ): { windowStart: Date; windowEnd: Date } {
    let baseHour = this.DEFAULT_WAKE_HOUR;
    let baseMinute = this.DEFAULT_WAKE_MINUTE;

    if (wakeTime) {
      const timeParts = wakeTime.split(':');
      if (timeParts.length === 2) {
        const hour = parseInt(timeParts[0], 10);
        const minute = parseInt(timeParts[1], 10);
        if (!isNaN(hour) && !isNaN(minute) && hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
          baseHour = hour;
          baseMinute = minute;
        }
      }
    }

    const [year, month, day] = dateKey.split('-').map(Number);
    const windowStart = new Date();
    windowStart.setFullYear(year, month - 1, day);
    windowStart.setHours(baseHour, baseMinute, 0, 0);

    const windowEnd = new Date(windowStart);
    windowEnd.setMinutes(windowEnd.getMinutes() + this.GREETING_WINDOW_DURATION_MINUTES);

    return { windowStart, windowEnd };
  }

  private isWithinCheckWindow(now: Date): boolean {
    // Extrai a hora no timezone de São Paulo usando Intl.DateTimeFormat
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    });

    const hour = parseInt(formatter.format(now));
    return hour >= this.CHECK_WINDOW_START_HOUR && hour < this.CHECK_WINDOW_END_HOUR;
  }

  private async sendMorningGreetings(): Promise<void> {
    const now = new Date();
    const currentDateKey = this.getCurrentDateKey(now);

    this.logger.debug(`Checking morning greetings at ${now.toISOString()}`);

    // Reset do conjunto de envios se mudou o dia
    if (this.lastCheckDate !== currentDateKey) {
      this.sentGreetingsToday.clear();
      this.lastCheckDate = currentDateKey;
      this.logger.log(`New day detected: ${currentDateKey}. Resetting greeting tracker.`);
    }

    if (!this.isWithinCheckWindow(now)) {
      this.logger.debug(`Outside check window (current hour: ${now.getHours()}). Skipping.`);
      return;
    }

    if (!this.transports.length) {
      this.logger.warn('No greeting transports registered; skipping morning greetings.');
      return;
    }

    try {
      const users = await this.prisma.userProfile.findMany({
        where: {
          subscriptionExpiresAt: { gt: now },
          isActive: true,
        },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          wakeTime: true,
          subscriptionPlan: true,
          isActive: true,
        },
      });

      this.logger.log(`Found ${users.length} users for morning greetings check`);

      if (users.length === 0) {
        this.logger.debug('No active users found for morning greetings');
        return;
      }

      const eligibleUsers = users.filter((user) => {
        if (!user.phoneNumber || !user.isActive) return false;
        if (this.sentGreetingsToday.has(user.phoneNumber)) return false;

        const { windowStart, windowEnd } = this.getScheduledWindowForUser(
          user.id,
          currentDateKey,
          user.wakeTime,
        );
        return now >= windowStart && now <= windowEnd;
      });

      if (eligibleUsers.length === 0) {
        this.logger.log('No users ready to receive morning greetings at this time');
        return;
      }

      this.logger.log(`${eligibleUsers.length} users are eligible for greetings now`);

      await this.processBatches(eligibleUsers, currentDateKey);
    } catch (error) {
      this.logger.error('Failed to send morning greetings', error as Error);
    }
  }

  private async processBatches(
    users: Array<{
      id: number;
      phoneNumber: string;
      name: string;
      wakeTime: string | null;
      [key: string]: any;
    }>,
    dateKey: string,
  ): Promise<void> {
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < users.length; i += this.BATCH_SIZE) {
      const batch = users.slice(i, i + this.BATCH_SIZE);
      const batchNumber = Math.floor(i / this.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(users.length / this.BATCH_SIZE);

      this.logger.log(`Processing batch ${batchNumber}/${totalBatches}`);

      const sendPromises: Promise<void>[] = [];

      for (const user of batch) {
        const phoneNumber = user.phoneNumber!;
        const message = this.pickMessage();
        const { windowStart } = this.getScheduledWindowForUser(user.id, dateKey, user.wakeTime);

        const sendTask = this.sendToUser(phoneNumber, message, windowStart)
          .then(() => {
            this.sentGreetingsToday.add(phoneNumber);
            sentCount++;
          })
          .catch((error) => {
            this.logger.warn(`Failed to send greeting to ${phoneNumber}`, error);
            failedCount++;
          });

        sendPromises.push(sendTask);

        // Controle de concorrência
        if (sendPromises.length >= this.CONCURRENT_SENDS) {
          await Promise.allSettled(sendPromises);
          sendPromises.length = 0;
        }
      }

      // Aguarda promises restantes do lote
      await Promise.allSettled(sendPromises);

      // Delay entre batches
      if (i + this.BATCH_SIZE < users.length) {
        const nextBatchSize = Math.min(this.BATCH_SIZE, users.length - i - this.BATCH_SIZE);
        const delay = Math.min(
          nextBatchSize * this.DELAY_PER_USER_MS,
          this.MAX_DELAY_BETWEEN_BATCHES_MS,
        );
        await this.sleep(delay);
      }
    }

    this.logger.log(
      `Morning greetings complete: Sent=${sentCount}, Failed=${failedCount}, Total=${users.length}`,
    );
  }

  private async sendToUser(
    phoneNumber: string,
    message: string,
    scheduledTime: Date,
  ): Promise<void> {
    for (const transport of this.transports) {
      await transport.send(phoneNumber, message);
      this.logger.log(
        `Greeting sent via ${transport.name} to ${phoneNumber} ` +
        `(scheduled ${scheduledTime.getHours()}:${String(scheduledTime.getMinutes()).padStart(2, '0')})`,
      );
    }
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.morningMessages.length);
    return this.morningMessages[idx] ?? this.morningMessages[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
