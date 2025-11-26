import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from 'src/telegram/telegram.service';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import { CreateGptDto } from './dto/create-gpt.dto';
import { UpdateGptDto } from './dto/update-gpt.dto';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class GptService {
  private readonly logger = new Logger(GptService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly assistantId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {
    const apiKey = this.configService.get<string>('gpt.apiKey')?.trim();
    this.assistantId = this.configService.get<string>('gpt.assistantId')?.trim() ?? '';

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
    const response = await this.generateResponse(message.prompt, chatId);
    await this.telegramService.sendMessage(chatId, response);
  }

  public async generateResponse(prompt: string, chatId: number | string): Promise<string> {
    if (!this.client) {
      return 'O modelo GPT não está configurado no momento.';
    }

    const maxRetries = 3;
    const baseDelayMs = 600;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let rawText: string;

        if (this.assistantId) {
          console.log('GPT Assistants: using assistant', this.assistantId);
          const profile = await this.prisma.userProfile.findUnique({ where: { chatId: BigInt(chatId) } });
          let threadId = profile?.assistantThreadId ?? null;
          if (!threadId) {
            const created = await this.client.beta.threads.create({});
            threadId = created.id;
            console.log('GPT Assistants: thread created', threadId);
            if (profile) {
              await this.prisma.userProfile.update({
                where: { chatId: BigInt(chatId) },
                data: { assistantThreadId: threadId },
              });
            }
          } else {
            console.log('GPT Assistants: reusing thread', threadId);
          }

          await this.client.beta.threads.messages.create(threadId, { role: 'user', content: prompt });
          const run = await this.client.beta.threads.runs.create(threadId, { assistant_id: this.assistantId });
          console.log('GPT Assistants: run started', run.id);
          for (; ;) {
            const current = await (this.client.beta.threads.runs.retrieve as any)(run.id, { thread_id: threadId });
            console.log('GPT Assistants: run status', current.status);
            if (current.status === 'completed') break;
            if (current.status === 'failed' || current.status === 'cancelled' || current.status === 'expired') {
              throw new Error(`Assistant run ${current.status}`);
            }
            await new Promise((r) => setTimeout(r, 800));
          }
          const msgs = await this.client.beta.threads.messages.list(threadId, { order: 'desc', limit: 5 });
          console.log('GPT Assistants: messages fetched', msgs.data.length);
          const msg = msgs.data.find((m) => m.role === 'assistant') ?? msgs.data[0];
          rawText = (msg?.content ?? [])
            .map((c: any) => (c.type === 'text' ? c.text.value : ''))
            .join('\n')
            .trim();
        } else {
          console.log('GPT Chat Completions: using model', this.model);
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
          });

          const choice = completion.choices[0]?.message?.content;
          rawText = (typeof choice === 'string' ? choice : choice ?? '').trim();
        }

        if (!rawText) {
          return 'Não consegui gerar uma resposta agora.';
        }

        console.log('--- RESPOSTA RECEBIDA DO GPT ---', rawText);

        try {
          const parsedResponse = JSON.parse(rawText);
          const { message: responseMessage, user_profile: userProfile } = parsedResponse;

          if (userProfile && Object.keys(userProfile).length > 0) {
            // Ensure chatId is treated as BigInt for Prisma, but UsersService might expect number.
            // If UsersService expects number, we might lose precision for very large IDs if not careful.
            // However, existing code used number. Let's try to pass it as is if it fits, or update UsersService.
            // For now, let's cast to any to bypass TS check if we are confident runtime handles it,
            // or better, let's update UsersService later.
            // But to be safe with current signature:
            const numericChatId = typeof chatId === 'string' ? parseInt(chatId, 10) : chatId;
            await this.usersService.updateProfileFromIA(numericChatId, userProfile);
            this.logger.log(`Perfil do chat ${chatId} atualizado via IA.`);
          }

          return responseMessage || 'Recebi uma resposta, mas sem mensagem para exibir.';
        } catch (jsonError) {
          // Se não for um JSON válido, retorna o texto como está
          return rawText;
        }
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
