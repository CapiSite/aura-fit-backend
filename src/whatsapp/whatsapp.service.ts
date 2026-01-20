import {
  Injectable,
  BadRequestException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigService } from '@nestjs/config';
import { CreateWhatsappDto } from './dto/create-whatsapp.dto';
import { WebhookEventDto } from './dto/webhook-event.dto';
import { GptService } from '../gpt/gpt.service';
import { PrismaService } from '../prisma_connection/prisma.service';
import { ReminderService } from 'src/common/triggers/reminder.service';
import { MorningGreetingService } from 'src/common/triggers/morning-greeting.service';
import { ConversionService } from 'src/common/triggers/conversion.service';

type ZapiSendTextResponse = { zaapId: string; messageId: string };

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly instanceId: string;
  private readonly token: string;
  private readonly clientToken: string;
  private readonly webhookMessages = new Map<string, any[]>();
  private readonly processedMessages = new Map<string, number>(); // messageKey -> timestamp
  private readonly messageQueues = new Map<string, Array<{ text: string, imageUrl?: string }>>(); // phone -> message queue
  private readonly processingQueues = new Map<string, boolean>(); // phone -> isProcessing queue
  private readonly lastErrorSent = new Map<string, number>(); // phone -> timestamp
  private readonly messageTimers = new Map<string, NodeJS.Timeout>(); // Gerencia timers de debounce

  private readonly lockFilePath = path.join(
    os.tmpdir(),
    'aura_whatsapp_startup.lock',
  );

  constructor(
    private readonly configService: ConfigService,
    private readonly gptService: GptService,
    private readonly prisma: PrismaService,
    private readonly reminderService: ReminderService,
    private readonly morningGreetingService: MorningGreetingService,
    private readonly conversionService: ConversionService,
  ) {
    this.instanceId =
      this.configService.get<string>('whatsapp.instanceId') ?? '';
    this.token = this.configService.get<string>('whatsapp.token') ?? '';
    this.clientToken =
      this.configService.get<string>('whatsapp.clientToken') ?? '';

  }

  async onModuleInit() {
    this.logger.log('WhatsappModule initialized.');

    // Registra WhatsApp como transport para lembretes
    this.reminderService.registerTransport({
      name: 'WhatsApp',
      send: async (phoneNumber, message) => {
        const phone = this.normalizePhone(phoneNumber);
        if (!phone) return;
        await this.sendText({ phone, message });
      },
    });

    // Registra WhatsApp como transport para mensagens matinais
    this.morningGreetingService.registerTransport({
      name: 'WhatsApp',
      send: async (phoneNumber, message) => {
        const phone = this.normalizePhone(phoneNumber);
        if (!phone) return;
        await this.sendText({ phone, message });
      },
    });

    // Registra WhatsApp como transport para mensagens de conversão
    this.conversionService.registerTransport({
      name: 'WhatsApp',
      send: async (phoneNumber, message) => {
        const phone = this.normalizePhone(phoneNumber);
        if (!phone) return;
        await this.sendText({ phone, message });
      },
    });

    if (this.shouldSkipStartupMessage()) {
      this.logger.warn(
        'Startup message skipped due to debounce (sent recently).',
      );
      return;
    }

    this.logger.log('Scheduling startup message...');
    // Aguarda um curto período para garantir que tudo esteja conectado
    setTimeout(() => {
      this.sendInitialMessageToActiveUsers();
      this.updateLockFile();
    }, 5000);
  }

  private shouldSkipStartupMessage(): boolean {
    try {
      if (!fs.existsSync(this.lockFilePath)) {
        return false;
      }
      const stats = fs.statSync(this.lockFilePath);
      const now = Date.now();
      const lastModified = stats.mtimeMs;
      // Debounce window: 15 minutes
      const debounceWindow = 15 * 60 * 1000;

      return now - lastModified < debounceWindow;
    } catch (error) {
      this.logger.error('Error checking lock file', error);
      return false;
    }
  }

  private updateLockFile() {
    try {
      fs.writeFileSync(this.lockFilePath, new Date().toISOString());
    } catch (error) {
      this.logger.error('Error updating lock file', error);
    }
  }

  private async sendInitialMessageToActiveUsers() {
    try {
      const activeUsers = await this.prisma.userProfile.findMany({
        where: {
          subscriptionExpiresAt: {
            gt: new Date(),
          },
        },
      });

      this.logger.log(
        `Found ${activeUsers.length} active users to send welcome message.`,
      );

      for (const user of activeUsers) {
        const userPhone = user.phoneNumber;
        if (!userPhone) continue;

        try {
          // Normaliza o telefone para garantir formato correto
          const phone = this.normalizePhone(userPhone);

          // Mensagem de status inicial desativada a pedido do usuario.
          // await this.sendText({
          //   phone,
          //   message:
          //     'Olá! A Aura está online e pronta para ajudar. Se precisar de algo, é só chamar!',
          // });
          // this.logger.log(`Active status message sent to ${phone}`);

          // Pequeno delay para evitar rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err) {
          this.logger.error(
            `Failed to send active status message to ${userPhone}`,
            err,
          );
        }
      }
    } catch (error) {
      this.logger.error('Error in sendInitialMessageToActiveUsers', error);
    }
  }

  private get baseUrl() {
    return `https://api.z-api.io/instances/${this.instanceId}/token/${this.token}`;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Client-Token': this.clientToken,
    };
  }

  private normalizePhone(phone?: string) {
    return phone?.replace(/[^\d]/g, '') ?? '';
  }

  private tryParseChatId(phone: string): string | null {
    const normalized = this.normalizePhone(phone);
    if (!normalized) {
      return null;
    }
    return normalized;
  }

  private normalizeMessagesResponse(payload: any) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload?.messages)) {
      return payload.messages;
    }

    if (Array.isArray(payload?.data)) {
      return payload.data;
    }

    return [];
  }


  private ensureConfigured() {
    if (!this.instanceId || !this.token || !this.clientToken) {
      throw new BadRequestException('Z-API credentials are not configured');
    }
  }

  private extractPhoneFromWebhook(payload: WebhookEventDto) {
    const candidates = [
      payload?.message?.chatId,
      payload?.data?.chatId,
      payload?.body?.chatId,
      payload?.chatId,
      payload?.message?.from,
      payload?.data?.from,
      payload?.from,
      payload?.phone,
    ].filter(Boolean) as string[];

    if (!candidates.length) {
      return '';
    }

    const cleaned = candidates[0].replace(/@.+$/, '');
    return this.normalizePhone(cleaned);
  }

  private buildMessageKey(
    phone: string,
    payload: WebhookEventDto,
  ): string | null {
    const candidates = [
      payload?.messageId,
      payload?.message?.messageId,
      payload?.message?.id,
      payload?.data?.messageId,
      payload?.data?.id,
      payload?.body?.messageId,
      payload?.text?.messageId,
      payload?.message?.timestamp,
      payload?.timestamp,
    ].filter(Boolean) as (string | number)[];

    if (!phone || candidates.length === 0) {
      return null;
    }

    return `${phone}:${candidates[0]}`;
  }

  private registerMessageKey(key: string) {
    const now = Date.now();
    this.processedMessages.set(key, now);

    // Clean entries older than 1 day to avoid unbounded growth
    const oneDayMs = 24 * 60 * 60 * 1000;
    for (const [k, ts] of this.processedMessages.entries()) {
      if (now - ts > oneDayMs) {
        this.processedMessages.delete(k);
      }
    }
  }

  private async processMessageQueue(phone: string) {
    // Marca como processando
    this.processingQueues.set(phone, true);

    try {
      while (true) {
        const queue = this.messageQueues.get(phone) || [];

        if (queue.length === 0) {
          break;
        }

        const firstMsg = queue.shift();
        if (!firstMsg) continue;

        let combinedText = firstMsg.text;
        let combinedImageUrl = firstMsg.imageUrl;

        while (queue.length > 0) {
          const nextMsg = queue[0];

          if (combinedImageUrl && nextMsg.imageUrl) {
            break;
          }

          const consumed = queue.shift()!;
          combinedText += '\n' + consumed.text;

          if (consumed.imageUrl) {
            combinedImageUrl = consumed.imageUrl;
          }
        }

        this.messageQueues.set(phone, queue);

        console.log(
          `Processing message batch for ${phone}: ${combinedText.substring(0, 100)}... ${combinedImageUrl ? '(with image)' : ''}`,
        );

        try {
          const response = await this.gptService.generateResponse(
            combinedText,
            phone,
            combinedImageUrl,
          );

          // Se a resposta for uma mensagem de erro, verifica cooldown
          const isErrorMessage = response.includes('Aguarde um momento') ||
            response.includes('problema temporário') ||
            response.includes('dificuldades técnicas');

          if (isErrorMessage) {
            const lastError = this.lastErrorSent.get(phone) || 0;
            const now = Date.now();
            const errorCooldown = 30 * 1000; // 30 segundos

            if (now - lastError < errorCooldown) {
              console.log(
                `Suppressing error message for ${phone} - cooldown active`,
              );
              continue;
            }

            this.lastErrorSent.set(phone, now);
          }

          await this.sendText({ phone, message: response });
        } catch (error) {
          console.error('Error generating AI response for WhatsApp:', error);

          // Verifica cooldown antes de enviar mensagem de erro genérica
          const lastError = this.lastErrorSent.get(phone) || 0;
          const now = Date.now();
          const errorCooldown = 30 * 1000;

          if (now - lastError >= errorCooldown) {
            await this.sendText({
              phone,
              message:
                'Desculpe, tive um problema temporário. Aguarde alguns instantes antes de tentar novamente.',
            });
            this.lastErrorSent.set(phone, now);
          }
        }

        // Delay removido para máxima velocidade
      }
    } finally {
      // Remove marca de processamento
      this.processingQueues.delete(phone);

      // Limpa fila vazia
      const queue = this.messageQueues.get(phone) || [];
      if (queue.length === 0) {
        this.messageQueues.delete(phone);
      }
    }
  }

  private async isAuthorizedPhone(phone: string): Promise<boolean> {
    const phoneNumber = this.tryParseChatId(phone);
    if (!phoneNumber) {
      return false;
    }

    const profile = await this.prisma.userProfile.findUnique({
      where: { phoneNumber },
      select: { phoneNumber: true },
    });

    return Boolean(profile);
  }

  private async ensureUserProfile(phoneNumber: string, name?: string) {
    // FREE plan tem 3 dias de teste
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    return this.prisma.userProfile.upsert({
      where: { phoneNumber },
      update: {
        subscriptionPlan: 'FREE',
        subscriptionExpiresAt: expiresAt,
        ...(name ? { name } : {}),
      },
      create: {
        phoneNumber,
        cpf: null,
        email: null,
        name: name || 'Usuário WhatsApp',
        goals: [],
        dietaryRestrictions: [],
        preferences: [],
        allergies: [],
        medicalConditions: [],
        medications: [],
        subscriptionPlan: 'FREE',
        subscriptionExpiresAt: expiresAt,
        requestsToday: 0,
        requestsLastReset: new Date(),
      },
    });
  }

  async handleWebhook(payload: WebhookEventDto) {
    const phone = this.extractPhoneFromWebhook(payload);
    if (phone) {
      const historical = this.webhookMessages.get(phone) ?? [];
      this.webhookMessages.set(phone, [...historical, payload]);
    }
    console.log('WhatsApp webhook event received', {
      phone,
      type: payload?.type,
      hasMessage: Boolean(payload?.message),
    });

    const textMessage =
      payload?.message?.text?.message ||
      payload?.text?.message ||
      payload?.message?.caption ||
      payload?.caption;
    let imageUrl =
      payload?.message?.imageUrl || payload?.imageUrl || payload?.image;

    console.log('DEBUG: Raw imageUrl detected:', {
      type: typeof imageUrl,
      value: imageUrl,
      isObject: typeof imageUrl === 'object',
      hasUrl: imageUrl?.url,
    });

    if (typeof imageUrl === 'object' && imageUrl?.url) {
      imageUrl = imageUrl.url;
    }

    if (typeof imageUrl === 'object') {
      console.warn(
        'DEBUG: imageUrl is still an object, trying to extract string...',
      );
      imageUrl = imageUrl?.imageUrl || imageUrl?.link || null;
    }

    const isFromMe =
      payload?.message?.fromMe || payload?.fromMe || payload?.data?.fromMe;

    if (phone && (textMessage || imageUrl) && !isFromMe) {
      const messageKey = this.buildMessageKey(phone, payload);
      if (messageKey) {
        if (this.processedMessages.has(messageKey)) {
          console.log('Ignoring duplicated WhatsApp webhook', {
            phone,
            messageKey,
          });
          return { received: true, duplicated: true };
        }
        this.registerMessageKey(messageKey);
      }

      const phoneNumber = this.tryParseChatId(phone);
      if (!phoneNumber) {
        console.log(`Unable to parse phoneNumber from phone: ${phone}`);
        return { received: true };
      }

      let user = await this.prisma.userProfile.findUnique({
        where: { phoneNumber },
      });

      const senderName =
        payload?.senderName ||
        payload?.message?.senderName ||
        payload?.data?.senderName;

      // Update name if we have a senderName and the current name is the default
      if (user && senderName && user.name === 'Usuário WhatsApp') {
        await this.prisma.userProfile.update({
          where: { phoneNumber },
          data: { name: senderName },
        });
      }

      if (!user) {
        console.log(
          `Creating profile for unregistered phone: ${phone}, name: ${senderName}`,
        );
        user = await this.ensureUserProfile(phoneNumber, senderName);
      }

      // Check for plan expiration
      if (
        user.subscriptionExpiresAt &&
        user.subscriptionExpiresAt < new Date()
      ) {
        console.log(`Plan expired for user ${phone}`);
        await this.sendText({
          phone,
          message:
            'Seu plano venceu. Por favor, renove sua assinatura para continuar utilizando o serviço. Link: https://aurafit.ia.br',
        });
        return { received: true };
      }

      // Check if account is active
      if (!user.isActive) {
        console.log(`Account deactivated for user ${phone}`);
        await this.sendText({
          phone,
          message:
            'Sua conta está desativada. Para reativar, faça login novamente no sistema através do site. Link: https://aurafit.ia.br',
        });
        return { received: true, accountDeactivated: true };
      }

      // Adiciona mensagem à fila
      const queue = this.messageQueues.get(phone) || [];
      queue.push({
        text: textMessage || 'Analise esta imagem',
        imageUrl
      });
      this.messageQueues.set(phone, queue);

      console.log(
        `Added message to queue for ${phone}: ${textMessage || '[Image]'} (Queue size: ${queue.length})`,
      );

      // DEBOUNCE REAL: Cancela timer anterior se existir
      if (this.messageTimers.has(phone)) {
        clearTimeout(this.messageTimers.get(phone)!);
      }

      // Se não estiver processando, agenda/reagenda o início
      if (!this.processingQueues.get(phone)) {
        const timer = setTimeout(() => {
          this.messageTimers.delete(phone);
          if (!this.processingQueues.get(phone)) {
            this.processMessageQueue(phone).catch(err => {
              console.error(`Error processing queue for ${phone}:`, err);
            });
          }
        }, 1000);

        this.messageTimers.set(phone, timer);
      }
    }

    return { received: true };
  }

  async sendText(dto: CreateWhatsappDto): Promise<ZapiSendTextResponse> {
    this.ensureConfigured();
    const res = await fetch(`${this.baseUrl}/send-text`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ phone: dto.phone, message: dto.message }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(text || `Z-API error ${res.status}`);
    }
    const result = (await res.json()) as ZapiSendTextResponse;
    console.log('WhatsApp message sent', {
      phone: dto.phone,
      zaapId: result.zaapId,
      messageId: result.messageId,
    });
    return result;
  }

  async getQrCodeImage(): Promise<any> {
    this.ensureConfigured();
    const res = await fetch(`${this.baseUrl}/qr-code/image`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(text || `Z-API error ${res.status}`);
    }
    return await res.json();
  }

  async getChatMessages(phone: string): Promise<any> {
    const normalizedPhone = this.normalizePhone(phone);
    const cachedMessages = this.webhookMessages.get(normalizedPhone) ?? [];
    console.log('Serving messages from webhook cache', {
      phone: normalizedPhone,
      count: cachedMessages.length,
    });
    return cachedMessages;
  }
}
