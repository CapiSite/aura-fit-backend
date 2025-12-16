import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from '../telegram/telegram.service';
import { CreateGeminiDto } from './dto/create-gemini.dto';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly model: GenerativeModel | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService,
  ) {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not set. Gemini responses are disabled.');
      this.model = null;
    } else {
      const modelName = this.configService.get<string>('gemini.model') ?? 'gemini-2.5-flash';
      const client = new GoogleGenerativeAI(apiKey);
      this.model = client.getGenerativeModel({ model: modelName });
    }

    this.telegramService.onMessage((message) => {
      void this.handleIncomingMessage(message);
    });
  }

  create(_createGeminiDto: CreateGeminiDto) {
    return 'This action adds a new gemini';
  }

  private async handleIncomingMessage(message: TelegramBot.Message & { prompt: string }) {
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
    const response = await this.generateResponse(message.prompt);
    await this.telegramService.sendMessage(chatId, response);
  }

  private async generateResponse(prompt: string): Promise<string> {
    if (!this.model) {
      return 'O modelo Gemini não está configurado no momento.';
    }

    const maxRetries = 3;
    const baseDelayMs = 600;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const text = result.response.text()?.trim();
        return text && text.length > 0 ? text : 'Não consegui gerar uma resposta agora.';
      } catch (error) {
        const status = (error as any)?.status;
        if (status === 503 || status === 429) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        if (status === 403) {
          this.logger.error('Acesso ao Gemini negado (403). Verifique a chave da API e permissões.', error as Error);
          return 'Configuração de acesso ao Gemini inválida. Verifique a chave da API.';
        }
        this.logger.error('Erro ao gerar resposta no Gemini', error as Error);
        return 'Tive um problema para falar com o Gemini agora. Tente novamente em instantes.';
      }
    }

    return 'O Gemini está sobrecarregado. Tente novamente em instantes.';
  }
}
