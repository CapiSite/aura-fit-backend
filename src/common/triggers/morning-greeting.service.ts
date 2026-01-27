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
  private readonly GREETING_WINDOW_DURATION_MINUTES = 30; // Janela de tolerância para inicialização

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
      // 1. Busca usuários cuja "próxima saudação" venceu OU que ainda não têm data definida (inicialização)
      const users = await this.prisma.userProfile.findMany({
        where: {
          isActive: true,
          subscriptionExpiresAt: { gt: now },
          wakeTime: { not: null }, // Só quem tem horário definido
          OR: [
            { nextMorningGreetingAt: { lte: now } },
            { nextMorningGreetingAt: null },
          ],
        },
        take: 100, // Processa em lotes de 100 para evitar bloqueio no self-healing
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          wakeTime: true,
          nextMorningGreetingAt: true,
        },
      });

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

    // Cenário 1: Usuário já tem data agendada e ela chegou (ou atrasou)
    if (user.nextMorningGreetingAt) {
      shouldSend = true;
      // Calcula próxima data (Amanhã no horário de acordar)
      nextDate = this.calculateNextExecution(wakeTime, now);
    }
    // Cenário 2: Inicialização (campo null)
    else {
      // Verifica se deve enviar AGORA (está na janela) ou apenas agendar
      const { hour, minute } = this.timezoneService.parseTimeString(wakeTime, 6, 0);
      const isInWindow = this.timezoneService.isWithinTimeWindow(hour, minute, this.GREETING_WINDOW_DURATION_MINUTES, now);

      if (isInWindow) {
        // Acordou agora (ou há < 30 min) -> Envia e agenda amanhã
        shouldSend = true;
        nextDate = this.calculateNextExecution(wakeTime, now);
      } else {
        // Não é a hora dele. Descobre se é hoje mais tarde ou amanhã.
        const todayTarget = this.getDateFromTime(wakeTime, now);

        if (todayTarget > now) {
          // É hoje mais tarde
          nextDate = todayTarget;
        } else {
          // Já passou hoje, fica pra amanhã
          nextDate = new Date(todayTarget);
          nextDate.setDate(nextDate.getDate() + 1);
        }
      }
    }

    // Executa Ações
    try {
      if (shouldSend) {
        const message = this.pickMessage();
        await this.sendToUser(user.phoneNumber, message);
      }

      // Atualiza banco com a próxima data
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
    // Pega a data de "hoje" no horário de acordar
    const todayTarget = this.getDateFromTime(wakeTime, now);

    // Sempre joga para o dia seguinte do "agora" (ou do target se preferir, mas user já recebeu hoje)
    // Se recebeu agora, o próximo é amanhã.
    const next = new Date(todayTarget);
    next.setDate(next.getDate() + 1);

    return next;
  }

  private getDateFromTime(timeString: string, referenceDate: Date): Date {
    const { hour, minute } = this.timezoneService.parseTimeString(timeString, 6, 0);

    // Constrói data no Timezone correto (SP)
    // Se usássemos setHours direto, dependeríamos do timezone do servidor (ex: UTC)
    // 08:00 UTC != 08:00 BRT.

    // 1. Pega data (dia/mês/ano) de SP baseada na referência
    const spDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(referenceDate);

    const year = spDate.find(p => p.type === 'year')?.value;
    const month = spDate.find(p => p.type === 'month')?.value;
    const day = spDate.find(p => p.type === 'day')?.value;

    // 2. Monta String ISO com Offset fixo de SP (-03:00)
    // Nota: SP não tem DST atualmente, então -03:00 é seguro.
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
