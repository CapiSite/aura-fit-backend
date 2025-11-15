import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from 'src/telegram/telegram.service';
import { CreateGeminiDto } from './dto/create-gemini.dto';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly model: GenerativeModel | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService,
  ) {
    const apiKey =
      this.configService.get<string>('GEMINI_API_KEY')
      ?? this.configService.get<string>('GEMNI_API_KEY');

    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not set. Gemini responses are disabled.');
      this.model = null;
    } else {
      const modelName = this.configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';
      const client = new GoogleGenerativeAI(apiKey);
      this.model = client.getGenerativeModel({ model: modelName });
    }

    this.telegramService.onMessage((message) => {
      console.log('message' + message);
      void this.handleIncomingMessage(message);
    });
  }

  create(_createGeminiDto: CreateGeminiDto) {
    return 'This action adds a new gemini';
  }

  private async handleIncomingMessage(message: TelegramBot.Message) {
    const chatId = message.chat.id;
    const text = message.text?.trim();

    if (!text) {
      return;
    }

    if (text.startsWith('/start')) {
      const firstName = message.from?.first_name ?? 'aí';
      await this.telegramService.sendMessage(chatId, `Olá, ${firstName}! 👋 Pode me enviar sua mensagem que eu consulto o Gemini.`);
      return;
    }

    await this.telegramService.sendTypingAction(chatId);
    const response = await this.generateResponse(text);
    await this.telegramService.sendMessage(chatId, response);
  }

  private async generateResponse(prompt: string): Promise<string> {
    if (!this.model) {
      return 'O modelo Gemini não está configurado no momento.';
    }

    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text()?.trim();
      return text && text.length > 0 ? text : 'Não consegui gerar uma resposta agora.';
    } catch (error) {
      this.logger.error('Erro ao gerar resposta no Gemini', error as Error);
      return 'Tive um problema para falar com o Gemini agora. Tente novamente em instantes.';
    }
  }
}
