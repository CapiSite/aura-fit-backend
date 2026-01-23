import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { TimezoneService } from '../services/timezone.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {
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

  /**
   * Verifica se o horário atual está dentro da janela de envio do usuário
   * baseado no wakeTime configurado (janela de 30 minutos após wakeTime)
   */
  private isWithinUserWindow(wakeTime: string | null, now: Date = new Date()): boolean {
    const { hour: wakeHour, minute: wakeMinute } = this.timezoneService.parseTimeString(
      wakeTime,
      this.DEFAULT_WAKE_HOUR,
      this.DEFAULT_WAKE_MINUTE,
    );

    return this.timezoneService.isWithinTimeWindow(
      wakeHour,
      wakeMinute,
      this.GREETING_WINDOW_DURATION_MINUTES,
      now,
    );
  }

  /**
   * Verifica se estamos dentro da janela geral de verificação (5h-11h)
   */
  private isWithinCheckWindow(now: Date = new Date()): boolean {
    const currentHour = this.timezoneService.getCurrentHour(now);
    return currentHour >= this.CHECK_WINDOW_START_HOUR && currentHour < this.CHECK_WINDOW_END_HOUR;
  }

  /**
   * Formata o horário de acordar para log
   */
  private formatWakeTimeForLog(wakeTime: string | null): string {
    const { hour, minute } = this.timezoneService.parseTimeString(
      wakeTime,
      this.DEFAULT_WAKE_HOUR,
      this.DEFAULT_WAKE_MINUTE,
    );
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private async sendMorningGreetings(): Promise<void> {
    const now = new Date();
    const currentDateKey = this.timezoneService.getCurrentDateKey(now);

    this.logger.debug(`Checking morning greetings at ${now.toISOString()}`);

    // Reset do conjunto de envios se mudou o dia
    if (this.lastCheckDate !== currentDateKey) {
      this.sentGreetingsToday.clear();
      this.lastCheckDate = currentDateKey;
      this.logger.log(`New day detected: ${currentDateKey}. Resetting greeting tracker.`);
    }

    if (!this.isWithinCheckWindow(now)) {
      const currentHour = this.timezoneService.getCurrentHour(now);
      this.logger.debug(`Outside check window (current hour: ${currentHour}). Skipping.`);
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

        // Usa o método que compara horários no timezone de São Paulo
        return this.isWithinUserWindow(user.wakeTime, now);
      });

      if (eligibleUsers.length === 0) {
        this.logger.log('No users ready to receive morning greetings at this time');
        return;
      }

      this.logger.log(`${eligibleUsers.length} users are eligible for greetings now`);

      await this.processBatches(eligibleUsers);
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
        const wakeTimeFormatted = this.formatWakeTimeForLog(user.wakeTime);

        const sendTask = this.sendToUser(phoneNumber, message, wakeTimeFormatted)
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
    wakeTimeFormatted: string,
  ): Promise<void> {
    for (const transport of this.transports) {
      await transport.send(phoneNumber, message);
      this.logger.log(
        `Greeting sent via ${transport.name} to ${phoneNumber} (wake time: ${wakeTimeFormatted})`,
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
