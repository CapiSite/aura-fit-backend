import { Injectable, Logger } from '@nestjs/common';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';

@Injectable()
export class MorningGreetingService {
  private readonly logger = new Logger(MorningGreetingService.name);
  private readonly transports: ReminderTransport[] = [];
  private readonly checkIntervalMs = 10 * 60 * 1000; // verifica a cada 10 minutos

  private readonly morningMessages = [
    '☀️ Bom dia! Vamos acordar e começar o dia com o pé direito! Como posso te ajudar hoje?',
    '🌅 Bom dia! Hora de acordar e arrasar! O que você planeja conquistar hoje?',
    '💪 Bom dia! Um novo dia cheio de oportunidades! Como posso te apoiar hoje?',
    '✨ Bom dia! Levanta que o sucesso te espera! Vamos começar bem? Como posso ajudar?',
    '🔥 Bom dia! Acorda campeão(ã)! Mais um dia para ser a melhor versão de si! Em que posso ajudar?',
    '🌟 Bom dia! O dia promete, vamos aproveitar! Como posso te auxiliar hoje?',
    '⚡ Bom dia! Energia positiva para começar o dia! Vamos lá, como posso te ajudar?',
    '🎯 Bom dia! Foco e determinação! Mais um dia para alcançar seus objetivos! Posso ajudar em algo?',
  ];

  private greetingTimer?: NodeJS.Timeout;
  private sentGreetingsToday = new Set<string>(); // Rastreia quem já recebeu hoje
  private lastCheckDate: string | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.startScheduler();
  }

  registerTransport(transport: ReminderTransport) {
    this.transports.push(transport);
    this.logger.log(`Morning greeting transport registered: ${transport.name}`);
  }

  private startScheduler() {
    // Verifica imediatamente e depois a cada intervalo
    void this.sendMorningGreetings();
    this.greetingTimer = setInterval(
      () => void this.sendMorningGreetings(),
      this.checkIntervalMs,
    );
  }

  private getCurrentDateKey(now: Date): string {
    // Retorna uma chave única para o dia (YYYY-MM-DD)
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * Calcula o horário aleatório personalizado baseado no wakeTime do usuário.
   * Se o usuário acorda às 6h, recebe entre 6h-7h (wakeTime + 0 a 60 minutos aleatórios).
   * Se não tiver wakeTime, usa janela padrão de 6h-8h.
   * O horário muda a cada dia para o mesmo usuário.
   */
  private getScheduledTimeForUser(
    userId: number,
    dateKey: string,
    wakeTime: string | null
  ): Date {
    // Cria um "hash" combinando userId e data para gerar horário único por usuário/dia
    const seed = `${userId}-${dateKey}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }

    // Parse do wakeTime (formato esperado: "HH:mm" ou "HH:MM")
    let baseHour = 7; // Padrão se não tiver wakeTime
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

    // Gera um offset aleatório entre 0 e 60 minutos (wakeTime + 1 hora)
    const randomMinuteOffset = Math.abs(hash) % 60;

    // Calcula o horário final
    const totalMinutes = (baseHour * 60) + baseMinute + randomMinuteOffset;
    const finalHour = Math.floor(totalMinutes / 60);
    const finalMinute = totalMinutes % 60;

    // Cria a data agendada
    const scheduledTime = new Date();
    const [year, month, day] = dateKey.split('-').map(Number);
    scheduledTime.setFullYear(year, month - 1, day);
    scheduledTime.setHours(finalHour, finalMinute, 0, 0);

    return scheduledTime;
  }

  /**
   * Verifica se está em uma janela válida para verificar mensagens.
   * Janela ampla de 5h-13h para cobrir diferentes wakeTime dos usuários.
   */
  private isWithinCheckWindow(now: Date): boolean {
    const hour = now.getHours();
    return hour >= 13 && hour < 17;
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

    // Verifica se está dentro da janela de verificação (5h-14h)
    if (!this.isWithinCheckWindow(now)) {
      this.logger.debug(`Outside check window (current hour: ${now.getHours()}). Skipping.`);
      return;
    }

    if (!this.transports.length) {
      this.logger.warn('No greeting transports registered; skipping morning greetings.');
      return;
    }

    try {
      // Busca usuários ativos - inclui FREE (3 dias de teste), PLUS e PRO
      // FREE só funciona enquanto subscriptionExpiresAt > now (3 dias após registro)
      const users = await this.prisma.userProfile.findMany({
        where: {
          OR: [
            { subscriptionExpiresAt: { gt: now } }, // Assinatura válida (FREE tem 3 dias, PLUS/PRO conforme contratado)
            { isPaymentActive: true }, // Ou pagamento ativo
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

      this.logger.log(`Found ${users.length} active users for morning greetings check`);

      if (users.length === 0) {
        this.logger.debug('No active users found for morning greetings');
        return;
      }

      let sentCount = 0;
      let skippedCount = 0;
      let alreadySentCount = 0;

      for (const user of users) {
        const phoneNumber = user.phoneNumber;
        if (!phoneNumber) {
          this.logger.debug(`User ${user.id} (${user.name}) has no phone number. Skipping.`);
          skippedCount++;
          continue;
        }

        // Pula usuários inativos
        if (!user.isActive) {
          this.logger.debug(`User ${user.id} (${user.name}) is inactive. Skipping.`);
          skippedCount++;
          continue;
        }

        // Pula se já enviou hoje para este usuário
        if (this.sentGreetingsToday.has(phoneNumber)) {
          alreadySentCount++;
          continue;
        }

        // Calcula o horário agendado para este usuário hoje (baseado no wakeTime)
        const scheduledTime = this.getScheduledTimeForUser(user.id, currentDateKey, user.wakeTime);

        this.logger.debug(
          `User ${user.id} (${user.name}, ${phoneNumber}): ` +
          `Plan=${user.subscriptionPlan}, WakeTime=${user.wakeTime || 'not set'}, ` +
          `ScheduledTime=${scheduledTime.getHours()}:${String(scheduledTime.getMinutes()).padStart(2, '0')}, ` +
          `Now=${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
        );

        // Só envia se o horário agendado já passou
        if (now < scheduledTime) {
          this.logger.debug(
            `User ${user.id} (${user.name}): Scheduled time not reached yet. ` +
            `Scheduled: ${scheduledTime.toISOString()}, Now: ${now.toISOString()}`
          );
          skippedCount++;
          continue; // Ainda não chegou a hora deste usuário
        }

        const message = this.pickMessage();

        // Envia através de todos os transportes registrados
        for (const transport of this.transports) {
          try {
            await transport.send(phoneNumber, message);
            this.logger.log(
              `Morning greeting sent via ${transport.name} to ${phoneNumber} ` +
              `(scheduled for ${scheduledTime.getHours()}:${String(scheduledTime.getMinutes()).padStart(2, '0')})`
            );
          } catch (error) {
            this.logger.warn(
              `Failed to send morning greeting via ${transport.name} to ${phoneNumber}`,
              error as Error,
            );
          }
        }

        // Marca como enviado hoje
        this.sentGreetingsToday.add(phoneNumber);
        sentCount++;

        // Pequeno delay entre envios para evitar sobrecarga
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      this.logger.log(
        `Morning greetings cycle complete: ` +
        `Sent=${sentCount}, AlreadySent=${alreadySentCount}, Skipped=${skippedCount}, Total=${users.length}`
      );
    } catch (error) {
      this.logger.error('Failed to send morning greetings', error as Error);
    }
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.morningMessages.length);
    return this.morningMessages[idx] ?? this.morningMessages[0];
  }

  // Método para limpar o timer ao desligar o serviço
  onModuleDestroy() {
    if (this.greetingTimer) {
      clearInterval(this.greetingTimer);
    }
  }
}
