import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { MessageInterceptor } from 'src/telegram/telegram.service';
import { NutritionService } from 'src/nutrition/nutrition.service';
import { WorkoutsService } from 'src/workouts/workouts.service';

type ChatMode = 'nutrition' | 'workout';

@Injectable()
export class PromptInterceptor implements MessageInterceptor {
  private readonly modeByChat = new Map<number, ChatMode>();

  constructor(
    private readonly config: ConfigService,
    private readonly nutrition: NutritionService,
    private readonly workouts: WorkoutsService,
  ) { }

  handle(message: TelegramBot.Message): TelegramBot.Message & { prompt?: string } {
    const text = message.text?.trim();
    const chatId = message.chat.id;

    if (!text) {
      return message;
    }

    const normalized = text.toLowerCase();

    if (normalized.startsWith('/start') || normalized === '/reset') {
      this.modeByChat.delete(chatId);
      return { ...message, prompt: this.buildAskChoicePrompt() };
    }

    if (this.isNutritionChoice(normalized)) {
      this.modeByChat.set(chatId, 'nutrition');
      return { ...message, prompt: this.buildModePrompt('nutrition', text) };
    }

    if (this.isWorkoutChoice(normalized)) {
      this.modeByChat.set(chatId, 'workout');
      return { ...message, prompt: this.buildModePrompt('workout', text) };
    }

    const currentMode = this.modeByChat.get(chatId);
    if (!currentMode) {
      return { ...message, prompt: this.buildAskChoicePrompt() };
    }

    return { ...message, prompt: this.buildModePrompt(currentMode, text) };
  }

  private isNutritionChoice(normalized: string) {
    return (
      normalized === 'dieta' ||
      normalized === '/dieta' ||
      normalized.startsWith('dieta ') ||
      normalized.includes('nutricao') ||
      normalized.includes('nutrição')
    );
  }

  private isWorkoutChoice(normalized: string) {
    return (
      normalized === 'treino' ||
      normalized === '/treino' ||
      normalized.startsWith('treino ') ||
      normalized.includes('workout')
    );
  }

  private buildAskChoicePrompt(): string {
    return 'Olá! Você quer criar uma dieta ou um treino? Digite "dieta" ou "treino" para escolher.';
  }

  private buildModePrompt(mode: ChatMode, userText: string): string {
    const systemBase = this.config.get<string>('SYSTEM_PROMPT')?.trim();
    if (mode === 'nutrition') {
      return this.nutrition.buildPrompt(userText, systemBase);
    }
    return this.workouts.buildPrompt(userText, systemBase);
  }
}
