import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from '../telegram/telegram.service';
import { PrismaService } from '../prisma_connection/prisma.service';
import { CreateGptDto } from './dto/create-gpt.dto';
import { UpdateGptDto } from './dto/update-gpt.dto';
import { UsersService } from '../users/users.service';
import { McpService } from '../mcp/mcp.service';

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
    private readonly mcpService: McpService,
  ) {
    const apiKey = this.configService.get<string>('gpt.apiKey')?.trim();
    this.assistantId =
      this.configService.get<string>('gpt.assistantId')?.trim() ?? '';

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY is not set. GPT responses are disabled.',
      );
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

  private async handleIncomingMessage(
    message: TelegramBot.Message & { prompt: string },
  ) {
    const chatId = message.chat.id;
    const text = message.text?.trim();

    if (!text) {
      return;
    }

    if (text.startsWith('/start')) {
      const firstName = message.from?.first_name ?? 'amigo';
      await this.telegramService.sendMessage(
        chatId,
        `Olá, ${firstName}! Pode me enviar sua mensagem`,
      );
      return;
    }

    await this.telegramService.sendTypingAction(chatId);
    const response = await this.generateResponse(message.prompt, chatId);
    await this.telegramService.sendMessage(chatId, response);
  }

  public async generateResponse(
    prompt: string,
    chatId: number | string,
    imageUrl?: string,
  ): Promise<string> {
    if (!this.client) {
      return 'O modelo não está configurado no momento.';
    }

    const prismaChatId = String(chatId);
    const now = new Date();
    const profile = await this.prisma.userProfile.findUnique({
      where: { chatId: prismaChatId },
    });
    if (!profile) {
      return 'Perfil não encontrado.';
    }
    const limits: Record<string, number> = { FREE: 20, PLUS: 20, PRO: 40 };
    const last = profile.requestsLastReset ?? now;
    const resetNeeded =
      last.getUTCFullYear() !== now.getUTCFullYear() ||
      last.getUTCMonth() !== now.getUTCMonth() ||
      last.getUTCDate() !== now.getUTCDate();
    if (resetNeeded) {
      await this.prisma.userProfile.update({
        where: { chatId: prismaChatId },
        data: { requestsToday: 0, requestsLastReset: now },
      });
    }
    const plan = ((profile.subscriptionPlan as unknown as string) ?? 'FREE')
      .toString()
      .trim()
      .toUpperCase();
    const limit = limits[plan] ?? limits.FREE;
    const expiresAt = profile.subscriptionExpiresAt;
    const isTrialExpired =
      plan === 'FREE' &&
      !profile.isPaymentActive &&
      !!expiresAt &&
      now > expiresAt;
    if (isTrialExpired) {
      return 'Seu período de teste de 3 dias terminou. Assine PRO ou PLUS.';
    }
    const requestsToday = resetNeeded ? 0 : profile.requestsToday ?? 0;
    if (requestsToday >= limit) {
      return 'Você atingiu o limite diário do seu plano. Confira o seu plano no dashboard para mais informações. Link: https://aurafit.ia.br';
    }
    const updatedRequestsToday = requestsToday + 1;
    await this.prisma.userProfile.update({
      where: { chatId: prismaChatId },
      data: {
        requestsToday: updatedRequestsToday,
        ...(resetNeeded ? { requestsLastReset: now } : {}),
      },
    });
    await this.upsertPromptUsage(prismaChatId, now);
    const profileForContext = {
      ...profile,
      requestsToday: updatedRequestsToday,
      requestsLastReset: resetNeeded ? now : profile.requestsLastReset,
    };
    const profileJson = this.serializeProfile(profileForContext);
    const maxRetries = 3;
    const baseDelayMs = 600;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let rawText: string;

        if (this.assistantId) {
          console.log('GPT Assistants: using assistant', this.assistantId);
          let threadId = profile.assistantThreadId ?? null;
          if (!threadId) {
            const created = await this.client.beta.threads.create({});
            threadId = created.id;
            console.log('GPT Assistants: thread created', threadId);
            if (profile) {
              await this.prisma.userProfile.update({
                where: { chatId: prismaChatId },
                data: { assistantThreadId: threadId },
              });
            }
          } else {
            console.log('GPT Assistants: reusing thread', threadId);
          }

          const messageContent: any[] = [
            {
              type: 'text',
              text: `Perfil completo do usuário (JSON):\n${profileJson}`,
            },
            { type: 'text', text: prompt },
          ];
          if (imageUrl) {
            messageContent.push({
              type: 'image_url',
              image_url: { url: imageUrl },
            });
          }

          await this.client.beta.threads.messages.create(threadId, {
            role: 'user',
            content: messageContent,
          });

          const run = await this.client.beta.threads.runs.create(threadId, {
            assistant_id: this.assistantId,
            tools: this.mcpService.getTools().map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parametersSchema,
              },
            })) as any,
          });

          console.log('GPT Assistants: run started', run.id);

          for (; ;) {
            const currentRun = await this.client.beta.threads.runs.retrieve(
              run.id,
              { thread_id: threadId },
            );

            if (
              ['completed', 'failed', 'cancelled', 'expired'].includes(
                currentRun.status,
              )
            ) {
              console.log('GPT Assistants: run status', currentRun.status);
              if (currentRun.status !== 'completed') {
                throw new Error(`Assistant run ${currentRun.status}`);
              }
              break;
            }

            if (currentRun.status === 'requires_action') {
              console.log('GPT Assistants: run requires action');
              const toolCalls =
                currentRun.required_action?.submit_tool_outputs.tool_calls ??
                [];
              const toolOutputs: { tool_call_id: string; output: string }[] =
                [];

              for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                console.log(
                  `-> Calling tool: ${functionName} with args:`,
                  args,
                );
                const output = await this.mcpService.callTool(
                  functionName,
                  args,
                );

                toolOutputs.push({
                  tool_call_id: toolCall.id,
                  output: JSON.stringify(output),
                });
              }

              await this.client.beta.threads.runs.submitToolOutputs(run.id, {
                thread_id: threadId,
                tool_outputs: toolOutputs,
              });
              console.log('GPT Assistants: tool outputs submitted');
            }

            await new Promise((r) => setTimeout(r, 800));
          }

          const msgs = await this.client.beta.threads.messages.list(threadId, {
            order: 'desc',
            limit: 5,
          });
          console.log('GPT Assistants: messages fetched', msgs.data.length);
          const msg =
            msgs.data.find((m) => m.role === 'assistant') ?? msgs.data[0];
          rawText = (msg?.content ?? [])
            .map((c: any) => (c.type === 'text' ? c.text.value : ''))
            .join('\n')
            .trim();
        } else {
          console.log('GPT Chat Completions: using model', this.model);
          const messages: any[] = [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Perfil completo do usuário (JSON):\n${profileJson}`,
                },
                { type: 'text', text: prompt },
                ...(imageUrl
                  ? [{ type: 'image_url', image_url: { url: imageUrl } }]
                  : []),
              ],
            },
          ];

          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: messages,
          });

          const choice = completion.choices[0]?.message?.content;
          rawText = (
            typeof choice === 'string' ? choice : (choice ?? '')
          ).trim();
        }

        if (!rawText) {
          return 'Não consegui gerar uma resposta agora.';
        }

        console.log('--- RESPOSTA RECEBIDA DO GPT ---', rawText);

        try {
          const parsedResponse = JSON.parse(rawText);
          const { message: responseMessage, user_profile: userProfile } =
            parsedResponse;

          if (userProfile && Object.keys(userProfile).length > 0) {
            await this.usersService.updateProfileFromIA(
              prismaChatId,
              userProfile,
            );
            this.logger.log(`Perfil do chat ${chatId} atualizado via IA.`);
          }

          return (
            responseMessage ||
            'Recebi uma resposta, mas sem mensagem para exibir.'
          );
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

  private serializeProfile(profile: unknown): string {
    return JSON.stringify(
      profile,
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private async upsertPromptUsage(chatId: string, at: Date) {
    const day = this.startOfUtcDay(at);
    await this.prisma.promptUsage.upsert({
      where: { chatId_date: { chatId, date: day } },
      update: { count: { increment: 1 } },
      create: { chatId, date: day, count: 1 },
    });
  }
}
