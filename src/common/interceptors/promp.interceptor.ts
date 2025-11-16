import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { MessageInterceptor } from 'src/telegram/telegram.service';

@Injectable()
export class PromptInterceptor implements MessageInterceptor {
  constructor(private readonly config: ConfigService) {}

  handle(message: TelegramBot.Message): TelegramBot.Message & { prompt?: string } {
    const base =
      this.config.get<string>('SYSTEM_PROMPT')?.trim()
      ?? 'Voce e a Aura, assistente nutricionista virtual.';

    const text = message.text?.trim();
    if (!text) {
      return message;
    }

    const prompt = `${base}\n\nUsuario: ${text}`;
    return { ...message, prompt };
  }
}
