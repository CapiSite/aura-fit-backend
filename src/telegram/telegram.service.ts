import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from 'src/users/users.service';

export interface MessageInterceptor {
  handle(
    message: TelegramBot.Message,
  ): Promise<TelegramBot.Message & { prompt?: string }>;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot | null = null;
  private readonly reminderIntervalMs = 3 * 60 * 60 * 1000;
  private reminderTimer?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService, // Adicionado
    @Inject('MESSAGE_INTERCEPTORS')
    private readonly interceptors: MessageInterceptor[] = [],
  ) {
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

    void this.bot
      .getMe()
      .then((me) => {
        this.logger.log(
          `Bot @${me.username} connected and polling for updates`,
        );
      })
      .catch((err) => {
        this.logger.error('Failed to get bot info', err as Error);
      });

    this.setupWaterReminders();
  }

  onMessage(
    listener: (message: TelegramBot.Message & { prompt: string }) => void,
  ) {
    if (!this.bot) {
      this.logger.warn(
        'Telegram bot is disabled; onMessage listener not registered.',
      );
      return;
    }
    this.bot.on('message', async (message) => {
      let current: TelegramBot.Message & { prompt?: string } = message;
      for (const i of this.interceptors) {
        current = await i.handle(current);
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
    console.log('chat id', chatId);
  }

  private setupWaterReminders() {
    // align the first reminder to the next 3-hour slot within 06:00-22:00
    const now = new Date();
    const nextRun = this.getNextReminderDate(now);
    const delay = Math.max(nextRun.getTime() - now.getTime(), 0);

    setTimeout(() => {
      void this.sendWaterReminders();
      this.reminderTimer = setInterval(
        () => void this.sendWaterReminders(),
        this.reminderIntervalMs,
      );
    }, delay);
  }

  private getNextReminderDate(from: Date) {
    const allowedHours = [6, 9, 12, 15, 18, 21];
    for (const hour of allowedHours) {
      const candidate = new Date(from);
      candidate.setHours(hour, 0, 0, 0);
      if (candidate > from) {
        return candidate;
      }
    }
    const tomorrow = new Date(from);
    tomorrow.setDate(from.getDate() + 1);
    tomorrow.setHours(allowedHours[0], 0, 0, 0);
    return tomorrow;
  }

  private async sendWaterReminders() {
    if (!this.bot) {
      this.logger.warn('Telegram bot is disabled; skipping water reminders.');
      return;
    }
    const now = new Date();
    const hour = now.getHours();
    if (hour < 6 || hour > 22) {
      return;
    }

    try {
      const users = await this.usersService.findAll();
      const message = 'Hora de beber água! Mantenha-se hidratado ao longo do dia.';
      for (const user of users) {
        if (!user?.chatId) continue;
        try {
          await this.sendMessage(user.chatId, message);
        } catch (error) {
          this.logger.warn(
            `Failed to send water reminder to chatId ${user.chatId}`,
            error as Error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to send water reminders', error as Error);
    }
  }
}
