import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';

@Injectable()
export class MorningGreetingService {
  private readonly logger = new Logger(MorningGreetingService.name);
  private readonly transports: ReminderTransport[] = [];

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

  private sentGreetingsToday = new Set<string>(); // Rastreia quem já recebeu hoje
  private lastCheckDate: string | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.logger.log('MorningGreetingService initialized with cron scheduler');
  }

  registerTransport(transport: ReminderTransport) {
    this.transports.push(transport);
    this.logger.log(`Morning greeting transport registered: ${transport.name}`);
  }

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'morning-greeting-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleMorningGreetingCron() {
    await this.sendMorningGreetings();
  }

  private getCurrentDateKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  // Calcula janela de 30min baseada no wakeTime do usuario
  private getScheduledWindowForUser(
    userId: number,
    dateKey: string,
    wakeTime: string | null
  ): { windowStart: Date; windowEnd: Date } {
    let baseHour = 6;
    let baseMinute = 0;

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

    const WINDOW_DURATION_MINUTES = 30;

    const [year, month, day] = dateKey.split('-').map(Number);
    const windowStart = new Date();
    windowStart.setFullYear(year, month - 1, day);
    windowStart.setHours(baseHour, baseMinute, 0, 0);

    const windowEnd = new Date(windowStart);
    windowEnd.setMinutes(windowEnd.getMinutes() + WINDOW_DURATION_MINUTES);

    return { windowStart, windowEnd };
  }

  // Verifica se esta dentro da janela de verificacao (5h-11h)
  private isWithinCheckWindow(now: Date): boolean {
    const hour = now.getHours();
    return hour >= 5 && hour < 11;
  }

  private async sendMorningGreetings() {
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
          OR: [
            { subscriptionExpiresAt: { gt: now } },
            { isPaymentActive: true },
          ],
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

      const eligibleUsers = users.filter(user => {
        if (!user.phoneNumber || !user.isActive) return false;
        if (this.sentGreetingsToday.has(user.phoneNumber)) return false;

        const { windowStart, windowEnd } = this.getScheduledWindowForUser(user.id, currentDateKey, user.wakeTime);
        return now >= windowStart && now <= windowEnd;
      });

      if (eligibleUsers.length === 0) {
        this.logger.log('No users ready to receive morning greetings at this time');
        return;
      }

      this.logger.log(`${eligibleUsers.length} users are eligible for greetings now`);

      const BATCH_SIZE = 50;
      const CONCURRENT_SENDS = 5;
      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < eligibleUsers.length; i += BATCH_SIZE) {
        const batch = eligibleUsers.slice(i, i + BATCH_SIZE);
        this.logger.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(eligibleUsers.length / BATCH_SIZE)}`);

        const sendPromises: Promise<void>[] = [];

        for (const user of batch) {
          const phoneNumber = user.phoneNumber!;
          const message = this.pickMessage();
          const { windowStart } = this.getScheduledWindowForUser(user.id, currentDateKey, user.wakeTime);

          const sendTask = this.sendToUser(phoneNumber, message, windowStart)
            .then(() => {
              this.sentGreetingsToday.add(phoneNumber);
              sentCount++;
            })
            .catch(error => {
              this.logger.warn(`Failed to send greeting to ${phoneNumber}`, error);
              failedCount++;
            });

          sendPromises.push(sendTask);

          if (sendPromises.length >= CONCURRENT_SENDS) {
            await Promise.allSettled(sendPromises);
            sendPromises.length = 0;
          }
        }

        // Aguarda promises restantes do lote
        await Promise.allSettled(sendPromises);

        if (i + BATCH_SIZE < eligibleUsers.length) {
          const nextBatchSize = Math.min(BATCH_SIZE, eligibleUsers.length - i - BATCH_SIZE);
          const delay = Math.min(nextBatchSize * 50, 2000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      this.logger.log(
        `Morning greetings complete: Sent=${sentCount}, Failed=${failedCount}, Total=${eligibleUsers.length}`
      );
    } catch (error) {
      this.logger.error('Failed to send morning greetings', error as Error);
    }
  }
  private async sendToUser(
    phoneNumber: string,
    message: string,
    scheduledTime: Date
  ): Promise<void> {
    for (const transport of this.transports) {
      await transport.send(phoneNumber, message);
      this.logger.log(
        `Greeting sent via ${transport.name} to ${phoneNumber} ` +
        `(scheduled ${scheduledTime.getHours()}:${String(scheduledTime.getMinutes()).padStart(2, '0')})`
      );
    }
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.morningMessages.length);
    return this.morningMessages[idx] ?? this.morningMessages[0];
  }
}
