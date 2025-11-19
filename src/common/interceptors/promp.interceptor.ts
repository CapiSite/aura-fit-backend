import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { MessageInterceptor } from 'src/telegram/telegram.service';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import { UserProfile } from '@prisma/client';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class PromptInterceptor implements MessageInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async handle(
    message: TelegramBot.Message,
  ): Promise<TelegramBot.Message & { prompt?: string }> {
    const chatId = message.chat.id;
    const userMessage = message.text?.trim() ?? '';

    if (!userMessage) {
      return message as any;
    }

    // 1. Obter ou criar o perfil do usuário
    let userProfile = await this.prisma.userProfile.findUnique({
      where: { chatId },
    });

    if (!userProfile) {
      userProfile = await this.prisma.userProfile.create({
        data: {
          chatId,
          name: message.from?.first_name ?? 'Usuário',
          goals: [],
          dietaryRestrictions: [],
          preferences: [],
        },
      });
    }

    // 2. Processar a mensagem e atualizar o estado da conversa
    const updatedProfile = await this.usersService.processMessageAndUpdateProfile(
      userMessage,
      userProfile,
    );

    // 3. Construir o prompt de sistema com base no perfil atualizado
    const systemPrompt = this.buildSystemPrompt(updatedProfile);

    // 4. Combinar o prompt de sistema com a mensagem do usuário
    const finalPrompt = `${systemPrompt}\n\n[Histórico e Mensagem do Usuário]\n${userMessage}`;

    console.log('--- PROMPT ENVIADO PARA IA ---', finalPrompt);

    (message as any).prompt = finalPrompt;
    return message as any;
  }



  private buildSystemPrompt(profile: UserProfile): string {
    // Lida com a serialização de BigInt para JSON, que não é suportado nativamente.
    const profileJson = JSON.stringify(
      profile,
      (key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2, // Adiciona indentação para melhor legibilidade no prompt
    );

    // Adiciona instruções dinâmicas com base nos dados faltantes
    const instructions: string[] = [];
    if (!profile.weight) {
      instructions.push('Se for relevante, pergunte o peso do usuário.');
    }
    if (!profile.height) {
      instructions.push('Se for relevante, pergunte a altura do usuário.');
    }
    if (profile.goals.length === 0) {
      instructions.push(
        'Pergunte sobre os objetivos do usuário (ex: perder peso, ganhar massa muscular).',
      );
    }
    if (!profile.activityLevel) {
      instructions.push(
        'Pergunte sobre o nível de atividade física do usuário (sedentário, leve, moderado, etc.).',
      );
    }

    let systemPrompt = `[Contexto do Usuário em JSON]\n${profileJson}`;

    if (instructions.length > 0) {
      systemPrompt +=
        '\n\n[Instruções Adicionais]\n' +
        instructions.map((inst) => `- ${inst}`).join('\n');
    }

    return systemPrompt;
  }
}
