import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { TimezoneService } from '../services/timezone.service';

@Injectable()
export class MorningGreetingService {
  private readonly logger = new Logger(MorningGreetingService.name);
  private readonly transports: ReminderTransport[] = [];

  private readonly GREETING_WINDOW_DURATION_MINUTES = 30;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {
    this.logger.log('MorningGreetingService initialized with cron scheduler (Event-Driven)');
  }

  registerTransport(transport: ReminderTransport): void {
    this.transports.push(transport);
    this.logger.log(`Morning greeting transport registered: ${transport.name}`);
  }

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'morning-greeting-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleMorningGreetingCron(): Promise<void> {
    const now = new Date();
    this.logger.debug(`Checking morning greetings (Event-Driven) at ${now.toISOString()}`);

    if (!this.transports.length) {
      this.logger.warn('No greeting transports registered; skipping.');
      return;
    }

    try {
      const dueUsers = await this.prisma.userProfile.findMany({
        where: {
          isActive: true,
          subscriptionExpiresAt: { gt: now },
          wakeTime: { not: null },
          nextMorningGreetingAt: { lte: now },
        },
        take: 100,
        orderBy: { nextMorningGreetingAt: 'asc' },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          wakeTime: true,
          nextMorningGreetingAt: true,
        },
      });

      const availableSlots = 100 - dueUsers.length;
      let users = dueUsers;

      if (availableSlots > 0) {
        const selfHealUsers = await this.prisma.userProfile.findMany({
          where: {
            isActive: true,
            subscriptionExpiresAt: { gt: now },
            wakeTime: { not: null },
            nextMorningGreetingAt: null,
          },
          take: Math.min(availableSlots, 20),
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            phoneNumber: true,
            name: true,
            wakeTime: true,
            nextMorningGreetingAt: true,
          },
        });

        users = users.concat(selfHealUsers);
      }

      if (users.length === 0) {
        return;
      }

      this.logger.log(`Processing ${users.length} users for morning greeting update`);

      for (const user of users) {
        await this.processUser(user, now);
      }

    } catch (error) {
      this.logger.error('Failed to process morning greetings', error as Error);
    }
  }

  private async processUser(
    user: { id: number; phoneNumber: string; name: string | null; wakeTime: string | null; nextMorningGreetingAt: Date | null },
    now: Date
  ): Promise<void> {
    const wakeTime = user.wakeTime!;
    let shouldSend = false;
    let nextDate: Date;

    if (user.nextMorningGreetingAt) {
      shouldSend = true;
      nextDate = this.calculateNextExecution(wakeTime, now);
    }
    else {
      const { hour, minute } = this.timezoneService.parseTimeString(wakeTime, 6, 0);
      const isInWindow = this.timezoneService.isWithinTimeWindow(hour, minute, this.GREETING_WINDOW_DURATION_MINUTES, now);

      if (isInWindow) {
        shouldSend = true;
        nextDate = this.calculateNextExecution(wakeTime, now);
      } else {
        const todayTarget = this.getDateFromTime(wakeTime, now);

        if (todayTarget > now) {
          nextDate = todayTarget;
        } else {
          nextDate = new Date(todayTarget);
          nextDate.setDate(nextDate.getDate() + 1);
        }
      }
    }

    try {
      if (shouldSend) {
        const message = this.pickMessage();
        await this.sendToUser(user.phoneNumber, message);
      }
      await this.prisma.userProfile.update({
        where: { id: user.id },
        data: { nextMorningGreetingAt: nextDate },
      });

      this.logger.debug(`User ${user.id} processed. Sent: ${shouldSend}. Next: ${nextDate.toISOString()}`);

    } catch (error) {
      this.logger.error(`Error processing user ${user.id}`, error as Error);
    }
  }

  private calculateNextExecution(wakeTime: string, now: Date): Date {
    const todayTarget = this.getDateFromTime(wakeTime, now);

    const next = new Date(todayTarget);
    next.setDate(next.getDate() + 1);

    return next;
  }

  private getDateFromTime(timeString: string, referenceDate: Date): Date {
    const { hour, minute } = this.timezoneService.parseTimeString(timeString, 6, 0);

    const spDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(referenceDate);

    const year = spDate.find(p => p.type === 'year')?.value;
    const month = spDate.find(p => p.type === 'month')?.value;
    const day = spDate.find(p => p.type === 'day')?.value;

    const isoString = `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`;

    return new Date(isoString);
  }

  private async sendToUser(phoneNumber: string, message: string): Promise<void> {
    for (const transport of this.transports) {
      await transport.send(phoneNumber, message);
    }
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.morningMessages.length);
    return this.morningMessages[idx] ?? this.morningMessages[0];
  }
}
