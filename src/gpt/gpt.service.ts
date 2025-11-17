import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from 'src/telegram/telegram.service';
import { CreateGptDto } from './dto/create-gpt.dto';
import { UpdateGptDto } from './dto/update-gpt.dto';

@Injectable()
export class GptService {
  private readonly logger = new Logger(GptService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService,
  ) {
    const apiKey = this.configService.get<string>('gpt.apiKey')?.trim();

    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY is not set. GPT responses are disabled.');
      this.client = null;
      this.model = '';
    } else {
      this.client = new OpenAI({ apiKey });
      this.model = this.configService.get<string>('gpt.model') ?? 'gpt-4o-mini';
    }

    this.telegramService.onMessage((message) => {
      void this.handleIncomingMessage(message);
    });
  }

  create(_createGptDto: CreateGptDto) {
    return 'This action adds a new gpt';
  }

  findAll() {
    return `This action returns all gpt`;
  }

  findOne(id: number) {
    return `This action returns a #${id} gpt`;
  }

  update(id: number, _updateGptDto: UpdateGptDto) {
    return `This action updates a #${id} gpt`;
  }

  remove(id: number) {
    return `This action removes a #${id} gpt`;
  }

  private async handleIncomingMessage(message: TelegramBot.Message & { prompt: string }) {
    const chatId = message.chat.id;
    const text = message.text?.trim();

    if (!text) {
      return;
    }

    if (text.startsWith('/start')) {
      const firstName = message.from?.first_name ?? 'amigo';
      await this.telegramService.sendMessage(
        chatId,
        `Olá, ${firstName}! Pode me enviar sua mensagem que eu consulto o GPT.`,
      );
      return;
    }

    await this.telegramService.sendTypingAction(chatId);
    const response = await this.generateResponse(message.prompt);
    await this.telegramService.sendMessage(chatId, response);
  }

  private async generateResponse(prompt: string): Promise<string> {
    if (!this.client || !this.model) {
      return 'O modelo GPT não está configurado no momento.';
    }

    const maxRetries = 3;
    const baseDelayMs = 600;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
        });

        const choice = completion.choices[0]?.message?.content;
        const text = typeof choice === 'string' ? choice : choice ?? '';
        return text && text.trim().length > 0
          ? text.trim()
          : 'Não consegui gerar uma resposta agora.';
      } catch (error) {
        const status = (error as any)?.status;
        if (status === 503 || status === 429) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        if (status === 403 || status === 401) {
          this.logger.error(
            'Acesso ao GPT negado (401/403). Verifique a chave da API e permissões.',
            error as Error,
          );
          return 'Configuração de acesso ao GPT inválida. Verifique a chave da API.';
        }

        this.logger.error('Erro ao gerar resposta no GPT', error as Error);
        return 'Tive um problema para falar com o GPT agora. Tente novamente em instantes.';
      }
    }

    return 'O GPT está sobrecarregado. Tente novamente em instantes.';
  }
}
