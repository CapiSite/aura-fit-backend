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
  private readonly DAYS_BETWEEN_ATTEMPTS = 3;
  private readonly BATCH_SIZE = 50;
  private readonly CONCURRENT_SENDS = 5;
  private readonly DELAY_PER_MESSAGE_MS = 200;
  private readonly DELAY_PER_USER_MS = 500;

  private readonly conversionMessages = [
    '👋 Olá! Notamos que seu período de teste terminou. Que tal conhecer nossos planos pagos? Temos opções que vão te ajudar a alcançar seus objetivos! 💪\n\nAcesse: https://aurafit.ia.br',

    '🌟 Ei! Sentimos sua falta por aqui. Seu plano gratuito expirou, mas você pode continuar aproveitando todos os benefícios com nossos planos Plus ou Pro!\n\nConfira: https://aurafit.ia.br',

    '💡 Oi! Vimos que você experimentou a Aura no período gratuito. Gostou da experiência? Assine um plano e continue sua jornada de saúde! 🏃‍♂️\n\nVeja os planos: https://aurafit.ia.br',

    '✨ E aí! Seu teste grátis acabou, mas a jornada não precisa terminar aqui. Dá uma olhada nos nossos planos e escolha o que mais combina com você!\n\nAcesse: https://aurafit.ia.br',

    '🎯 Olá! Notamos que você não renovou seu plano. Podemos te ajudar a escolher a melhor opção para suas necessidades. Que tal dar uma olhada?\n\nConfira: https://aurafit.ia.br',
  ];

  constructor(private readonly prisma: PrismaService) {
    this.logger.log('ConversionService initialized with cron scheduler');
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
    await this.sendConversionMessages();
  }

  private async sendConversionMessages(): Promise<void> {
    const now = new Date();

    this.logger.log('Starting conversion message campaign...');

    if (!this.transports.length) {
      this.logger.warn('No conversion transports registered; skipping conversion messages.');
      return;
    }

    try {
      // Buscar usuários elegíveis para conversão
      const eligibleUsers = await this.findEligibleUsers(now);

      if (eligibleUsers.length === 0) {
        this.logger.log('No eligible users found for conversion messages');
        return;
      }

      this.logger.log(`Found ${eligibleUsers.length} users eligible for conversion`);

      // Filtrar usuários que ainda podem receber mensagens
      const usersToContact = this.filterByAttemptLimit(eligibleUsers, now);

      if (usersToContact.length === 0) {
        this.logger.log('All eligible users have reached max conversion attempts');
        return;
      }

      this.logger.log(`${usersToContact.length} users will receive conversion messages`);

      // Processar em lotes
      await this.processBatches(usersToContact, now);

    } catch (error) {
      this.logger.error('Failed to send conversion messages', error as Error);
    }
  }

  private async findEligibleUsers(now: Date) {
    return this.prisma.userProfile.findMany({
      where: {
        subscriptionPlan: 'FREE',
        subscriptionExpiresAt: { lt: now },
        isPaymentActive: false,
        isActive: true,
      },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        subscriptionExpiresAt: true,
        conversionAttempts: true,
        lastConversionMessageAt: true,
      },
    });
  }

  private filterByAttemptLimit(
    users: Array<{
      id: number;
      phoneNumber: string;
      conversionAttempts?: number | null;
      lastConversionMessageAt?: Date | null;
      [key: string]: any;
    }>,
    now: Date,
  ) {
    return users.filter((user) => {
      if (!user.phoneNumber) return false;

      const attempts = user.conversionAttempts ?? 0;

      // Atingiu limite máximo de tentativas
      if (attempts >= this.MAX_CONVERSION_ATTEMPTS) {
        return false;
      }

      // Primeira tentativa sempre pode ser enviada
      if (!user.lastConversionMessageAt) {
        return true;
      }

      // Verificar se já passou tempo suficiente desde última tentativa
      const daysSinceLastAttempt = this.getDaysDifference(
        user.lastConversionMessageAt,
        now,
      );

      return daysSinceLastAttempt >= this.DAYS_BETWEEN_ATTEMPTS;
    });
  }

  private async processBatches(
    users: Array<{ phoneNumber: string; name?: string;[key: string]: any }>,
    now: Date,
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
        const message = this.pickMessage();

        const sendTask = this.sendToUser(user.phoneNumber, message)
          .then(async () => {
            await this.updateConversionAttempt(user.id, now);
            sentCount++;
            this.logger.debug(`Conversion message sent to ${user.phoneNumber}`);
          })
          .catch((error) => {
            this.logger.warn(
              `Failed to send conversion message to ${user.phoneNumber}`,
              error,
            );
            failedCount++;
          });

        sendPromises.push(sendTask);

        // Delay individual entre mensagens para evitar rate limiting
        await this.sleep(this.DELAY_PER_MESSAGE_MS);

        // Controle de concorrência
        if (sendPromises.length >= this.CONCURRENT_SENDS) {
          await Promise.allSettled(sendPromises);
          sendPromises.length = 0;
        }
      }

      // Aguarda promises restantes do lote
      await Promise.allSettled(sendPromises);

      // Delay entre batches para evitar sobrecarga
      if (i + this.BATCH_SIZE < users.length) {
        const nextBatchSize = Math.min(
          this.BATCH_SIZE,
          users.length - i - this.BATCH_SIZE,
        );
        const delay = Math.min(nextBatchSize * this.DELAY_PER_USER_MS, 10000); // 500ms por usuário, máx 10s
        await this.sleep(delay);
      }
    }

    this.logger.log(
      `Conversion campaign complete: Sent=${sentCount}, Failed=${failedCount}, Total=${users.length}`,
    );
  }

  private async sendToUser(
    phoneNumber: string,
    message: string,
  ): Promise<void> {
    for (const transport of this.transports) {
      await transport.send(phoneNumber, message);
    }
  }

  private async updateConversionAttempt(
    userId: number,
    now: Date,
  ): Promise<void> {
    await this.prisma.userProfile.update({
      where: { id: userId },
      data: {
        conversionAttempts: { increment: 1 },
        lastConversionMessageAt: now,
      },
    });
  }

  private getDaysDifference(date1: Date, date2: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((date2.getTime() - date1.getTime()) / msPerDay);
  }

  private pickMessage(): string {
    const idx = Math.floor(Math.random() * this.conversionMessages.length);
    return this.conversionMessages[idx] ?? this.conversionMessages[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}
