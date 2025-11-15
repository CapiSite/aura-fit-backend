import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: TelegramBot;
  private readonly systemPrompt = 'Voce e a Aura, assistente nutricionista virtual.';

  constructor(private readonly configService: ConfigService) {
    const token =
      this.configService.get<string>('TELEGRAM_BOT_TOKEN')
      ?? this.configService.get<string>('TELEGTRAM_BOT_TOKEN');

    if (!token) {
      throw new Error('Telegram bot token is not configured');
    }

    this.bot = new TelegramBot(token, {
      polling: true,
    });

    this.logger.log('Telegram bot connected and polling for updates');
  }

  onMessage(listener: (message: TelegramBot.Message, prompt: string) => void) {
    this.bot.on('message', (message) => {
      const userText = message.text?.trim() ?? '';
      const prompt = `${this.systemPrompt}\n\nUsuario: ${userText}`;
      listener(message, prompt);
    });
  }

  async sendTypingAction(chatId: number | string) {
    try {
      await this.bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      this.logger.warn('Failed to send typing action', error as Error);
    }
  }

  async sendMessage(chatId: number | string, text: string) {
    await this.bot.sendMessage(chatId, text);
  }
}
