import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReminderTransport } from './reminder-transport.interface';
import { PrismaService } from '../../prisma_connection/prisma.service';

@Injectable()
export class ConversionService {
  private readonly logger = new Logger(ConversionService.name);
  private readonly transports: ReminderTransport[] = [];

  // Configurações
  private readonly MAX_CONVERSION_ATTEMPTS = 2;
  private readonly INTERVALS_DAYS = [3, 7]; // Intervalos: T1 (Hoje) -> +3d -> T2 -> +7d (Se houvesse T3)
  private readonly BATCH_SIZE = 50;
  private readonly CONCURRENT_SENDS = 5;
  private readonly DELAY_PER_MESSAGE_MS = 200;

  private readonly conversionMessages = [
    '👋 Olá! Notamos que seu período de teste terminou. Que tal conhecer nossos planos pagos? Temos opções que vão te ajudar a alcançar seus objetivos! 💪\n\nAcesse: https://aurafit.ia.br',
    '🌟 Ei! Sentimos sua falta por aqui. Seu plano gratuito expirou, mas você pode continuar aproveitando todos os benefícios com nossos planos Plus ou Pro!\n\nConfira: https://aurafit.ia.br',
    '💡 Oi! Vimos que você experimentou a Aura no período gratuito. Gostou da experiência? Assine um plano e continue sua jornada de saúde! 🏃‍♂️\n\nVeja os planos: https://aurafit.ia.br',
    '✨ E aí! Seu teste grátis acabou, mas a jornada não precisa terminar aqui. Dá uma olhada nos nossos planos e escolha o que mais combina com você!\n\nAcesse: https://aurafit.ia.br',
    '🎯 Olá! Notamos que você não renovou seu plano. Podemos te ajudar a escolher a melhor opção para suas necessidades. Que tal dar uma olhada?\n\nConfira: https://aurafit.ia.br',
  ];

  constructor(private readonly prisma: PrismaService) {
    this.logger.log('ConversionService initialized with cron scheduler (Event-Driven)');
  }

  registerTransport(transport: ReminderTransport): void {
    this.transports.push(transport);
    this.logger.log(`Conversion transport registered: ${transport.name}`);
  }

  @Cron('0 0 08 * * *', {
    name: 'conversion-reminder-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleConversionReminderCron(): Promise<void> {
    const now = new Date();
    this.logger.log('Starting conversion message campaign (Event-Driven)...');

    if (!this.transports.length) {
      this.logger.warn('No conversion transports registered; skipping conversion messages.');
      return;
    }

    try {
      // Busca usuários elegíveis:
      // 1. Expirados
      // 2. Plano FREE
      // 3. Status Ativo e Pagamento Inativo
      // 4. E (NextAttempt <= Now  OU  NextAttempt is NULL e ainda não tentou 0 vezes)
      const users = await this.prisma.userProfile.findMany({
        where: {
          isActive: true,
          isPaymentActive: false,
          subscriptionPlan: 'FREE',
          subscriptionExpiresAt: { lt: now },
          OR: [
            { nextConversionAttemptAt: { lte: now } },
            // Inicialização: Usuários antigos que nunca receberam (attempts=0) e não têm data
            { nextConversionAttemptAt: null, conversionAttempts: 0 }
          ]
        },
        take: 100, // Limite para segurança e self-healing gradual
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          conversionAttempts: true
        }
      });

      if (users.length === 0) {
        this.logger.log('No eligible users found for conversion messages today');
        return;
      }

      this.logger.log(`Found ${users.length} users eligible for conversion`);

      await this.processBatches(users, now);

    } catch (error) {
      this.logger.error('Failed to send conversion messages', error as Error);
    }
  }

  private async processBatches(
    users: Array<{ id: number; phoneNumber: string; name?: string | null; conversionAttempts: number }>,
    now: Date,
  ): Promise<void> {
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < users.length; i += this.BATCH_SIZE) {
      const batch = users.slice(i, i + this.BATCH_SIZE);
      const sendPromises: Promise<void>[] = [];

      for (const user of batch) {

        // Validação extra: Se usuário já tentou MAX vezes (banco inconsistente), ignora
        if (user.conversionAttempts >= this.MAX_CONVERSION_ATTEMPTS) {
          continue;
        }

        const message = this.pickMessage();

        const sendTask = this.sendToUser(user.phoneNumber, message)
          .then(async () => {
            // SUCESSO
            await this.updateUserNextAttempt(user.id, user.conversionAttempts, now);
            sentCount++;
            this.logger.debug(`Conversion message sent to ${user.phoneNumber}`);
          })
          .catch(async (error) => {
            // FALHA NA MENSAGEM
            // Opcional: Agendar retry curto? Ou pular e tentar amanhã?
            // Por simplificação: Mantemos a lógica de agendar a próxima etapa mesmo com falha de envio,
            // ou mantemos o nextAttemptAt como está para retry no próximo cron?
            // Melhor: Se falhar o envio (erro de transporte), NÃO atualiza o banco (retry amanhã).
            // Mas se for número inválido, deveríamos marcar para não tentar mais.
            // Assumindo erro temporário: não atualiza banco => tenta amanhã (lte: now continua válido)

            this.logger.warn(`Failed to send conversion message to ${user.phoneNumber}`, error);
            failedCount++;
          });

        sendPromises.push(sendTask);
        await this.sleep(this.DELAY_PER_MESSAGE_MS);

        if (sendPromises.length >= this.CONCURRENT_SENDS) {
          await Promise.allSettled(sendPromises);
          sendPromises.length = 0;
        }
      }

      await Promise.allSettled(sendPromises);
    }

    this.logger.log(
      `Conversion campaign complete: Sent=${sentCount}, Failed=${failedCount}, Total=${users.length}`,
    );
  }

  private async updateUserNextAttempt(userId: number, currentAttempts: number, now: Date): Promise<void> {
    const newAttempts = currentAttempts + 1;
    let nextDate: Date | null = null;

    // Se ainda não chegou no limite, agenda a próxima
    if (newAttempts < this.MAX_CONVERSION_ATTEMPTS) {
      // Pega intervalo baseado na tentativa atual (0->3 dias, 1->7 dias)
      const daysToAdd = this.INTERVALS_DAYS[currentAttempts] || 7;
      nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysToAdd);
    }
    // Se chegou no limite, nextDate fica NULL, e conversionAttempts >= MAX impede seleção futura

    await this.prisma.userProfile.update({
      where: { id: userId },
      data: {
        conversionAttempts: newAttempts,
        lastConversionMessageAt: now,
        nextConversionAttemptAt: nextDate
      }
    });
  }

  private async sendToUser(phoneNumber: string, message: string): Promise<void> {
    if (!phoneNumber) throw new Error('Phone number is missing');
    for (const transport of this.transports) {
      await transport.send(phoneNumber, message);
    }
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.conversionMessages.length);
    return this.conversionMessages[idx] ?? this.conversionMessages[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
