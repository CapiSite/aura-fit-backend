import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

export interface MessageInterceptor {
  handle(message: TelegramBot.Message): TelegramBot.Message & { prompt?: string };
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot | null = null;


  constructor(private readonly configService: ConfigService, @Inject('MESSAGE_INTERCEPTORS') private readonly interceptors: MessageInterceptor[] = []) {
    const token = this.configService.get<string>('telegram.token')?.trim();

    if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      this.logger.error('Invalid Telegram bot token format. Bot disabled.');
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });

    void this.bot.deleteWebHook().catch((err) => {
      this.logger.warn('Failed to delete webhook', err as Error);
    });

    this.bot.on('polling_error', (err) => {
      this.logger.error('Polling error', err as Error);
    });

    void this.bot.getMe().then((me) => {
      this.logger.log(`Bot @${me.username} connected and polling for updates`);
    }).catch((err) => {
      this.logger.error('Failed to get bot info', err as Error);
    });
  }

  onMessage(listener: (message: TelegramBot.Message & { prompt: string }) => void) {
    if (!this.bot) {
      this.logger.warn('Telegram bot is disabled; onMessage listener not registered.');
      return;
    }
    this.bot.on('message', (message) => {
      let current: TelegramBot.Message & { prompt?: string } = message;
      for (const i of this.interceptors) {
        current = i.handle(current);
      }
      if (!current.prompt) {
        return;
      }
      listener(current as TelegramBot.Message & { prompt: string });
    });
  }

  async sendTypingAction(chatId: number | string) {
    if (!this.bot) return;
    try {
      await this.bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      this.logger.warn('Failed to send typing action', error as Error);
    }
  }

  async sendMessage(chatId: number | string, text: string) {
    if (!this.bot) return;
    await this.bot.sendMessage(chatId, text);
    console.log('chat id', chatId)
  }
}
