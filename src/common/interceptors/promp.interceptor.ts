import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { MessageInterceptor } from 'src/telegram/telegram.service';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import { UserProfile } from '@prisma/client';

@Injectable()
export class PromptInterceptor implements MessageInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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
    const updatedProfile = await this.processMessageAndUpdateProfile(
      userMessage,
      userProfile,
    );

    // 3. Construir o prompt de sistema com base no perfil atualizado
    const systemPrompt = this.buildSystemPrompt(updatedProfile);

    // 4. Combinar o prompt de sistema com a mensagem do usuário
    const finalPrompt = `${systemPrompt}\n\n[Histórico e Mensagem do Usuário]\n${userMessage}`;

    (message as any).prompt = finalPrompt;
    return message as any;
  }

  private async processMessageAndUpdateProfile(
    message: string,
    profile: UserProfile,
  ): Promise<UserProfile> {
    let updatedData: Partial<UserProfile> = {};

    // Lógica simples para extrair informações e atualizar o estado
    // Isso pode ser expandido com regex ou até mesmo uma chamada à IA para extração de entidades

    if (profile.conversationState === 'ASKING_WEIGHT') {
      const weight = parseFloat(message.replace(',', '.'));
      if (!isNaN(weight)) {
        updatedData.weight = weight;
        updatedData.conversationState = null; // Limpa o estado
      }
    } else if (message.toLowerCase().includes('dieta')) {
      updatedData.conversationState = 'ASKING_GOALS'; // Exemplo de como iniciar um fluxo
    }

    if (Object.keys(updatedData).length > 0) {
      return this.prisma.userProfile.update({
        where: { chatId: profile.chatId },
        data: updatedData,
      });
    }

    return profile;
  }

  private buildSystemPrompt(profile: UserProfile): string {
    const basePrompt = this.config.get<string>('SYSTEM_PROMPT') ?? 'Você é um assistente prestativo.';

    const contextParts = [
      '\n[Contexto do Usuário]',
      `- Nome: ${profile.name}`,
      profile.goals.length > 0 ? `- Objetivos: ${profile.goals.join(', ')}` : '',
      profile.weight ? `- Peso: ${profile.weight} kg` : '',
      profile.height ? `- Altura: ${profile.height} cm` : '',
      profile.dietaryRestrictions.length > 0
        ? `- Restrições Alimentares: ${profile.dietaryRestrictions.join(', ')}`
        : '',
      profile.preferences.length > 0
        ? `- Preferências: ${profile.preferences.join(', ')}`
        : '',
    ];

    // Adiciona uma instrução com base no estado da conversa
    if (profile.conversationState === 'ASKING_GOALS') {
      contextParts.push(
        '\n[Instrução Adicional]: Pergunte ao usuário sobre seus objetivos (ganhar, perder ou manter peso) de forma amigável.',
      );
    } else if (!profile.weight) {
      contextParts.push(
        '\n[Instrução Adicional]: Se for relevante para a conversa, pergunte o peso do usuário.',
      );
    }

    return basePrompt + contextParts.filter(Boolean).join('\n');
  }
}
