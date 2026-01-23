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
  private readonly phoneId: string;
  private readonly accessToken: string;
  private readonly verifyToken: string;

  private readonly webhookMessages = new Map<string, any[]>();
  private readonly processedMessages = new Map<string, number>(); // messageKey -> timestamp
  private readonly lastMessageProcessed = new Map<string, number>(); // phone -> timestamp (debounce)
  private readonly lastErrorSent = new Map<string, number>(); // phone -> timestamp

  // Lock file logic maintained for startup message debounce
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
    this.phoneId = this.configService.get<string>('whatsapp.phoneId') ?? '';
    this.accessToken = this.configService.get<string>('whatsapp.accessToken') ?? '';
    this.verifyToken = this.configService.get<string>('whatsapp.verifyToken') ?? '';
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

  private get graphApiUrl() {
    return `https://graph.facebook.com/v21.0/${this.phoneId}/messages`;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
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

  private ensureConfigured() {
    if (!this.phoneId || !this.accessToken) {
      throw new BadRequestException('Meta WhatsApp credentials are not configured');
    }
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
    // Meta sends an object with "object": "whatsapp_business_account" and "entry": [...]
    if (payload.object !== 'whatsapp_business_account') {
      // Not a whatsapp webhook or just subscription verification
      return { received: true };
    }

    if (!payload.entry || !Array.isArray(payload.entry)) {
      return { received: true };
    }

    for (const entry of payload.entry) {
      const changes = entry.changes;
      if (!changes || !Array.isArray(changes)) continue;

      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        if (!value) continue;

        const messages = value.messages;
        if (!messages || !Array.isArray(messages)) continue;

        // "contacts" array usually contains the user name
        const contacts = value.contacts || [];
        // Dictionary for looking up names by wa_id (phone)
        const contactMap = new Map<string, string>();
        for (const contact of contacts) {
          if (contact.profile?.name) {
            contactMap.set(contact.wa_id, contact.profile.name);
          }
        }

        for (const message of messages) {
          await this.processSingleMessage(message, contactMap);
        }
      }
    }
    return { received: true };
  }

  private async processSingleMessage(message: import('./dto/webhook-event.dto').MetaMessage, contactMap: Map<string, string>) {
    const phoneRaw = message.from; // e.g., "5511999999999"
    const phone = this.normalizePhone(phoneRaw);
    if (!phone) return;

    // Ensure we store the entire raw message for history/debugging if needed
    // In Z-API logical we stored webhookMessages. Here we can simulate it.
    const historical = this.webhookMessages.get(phone) ?? [];
    this.webhookMessages.set(phone, [...historical, message]);

    console.log('WhatsApp webhook event received (Meta)', {
      phone,
      type: message.type,
    });

    // Check message type
    // Meta types: text, image, audio, etc.
    // user previous logic prioritized text and images.

    let textMessage: string | null = null;
    let imageUrl: string | null = null;

    if (message.type === 'text') {
      textMessage = message.text?.body || null;
    } else if (message.type === 'image') {
      textMessage = message.image?.caption || null; // Optional caption

    }

    const messageKey = `${phone}:${message.id}`;

    if (this.processedMessages.has(messageKey)) {
      console.log('Ignoring duplicated WhatsApp webhook', { phone, messageKey });
      return;
    }
    this.registerMessageKey(messageKey);

    const phoneNumber = this.tryParseChatId(phone);
    if (!phoneNumber) {
      console.log(`Unable to parse phoneNumber from phone: ${phone}`);
      return;
    }

    // Check sender name
    const senderName = contactMap.get(phoneRaw);

    let user = await this.prisma.userProfile.findUnique({ where: { phoneNumber } });

    // Update name
    if (user && senderName && user.name === 'Usuário WhatsApp') {
      await this.prisma.userProfile.update({
        where: { phoneNumber },
        data: { name: senderName },
      });
    }

    if (!user) {
      console.log(`Creating profile for unregistered phone: ${phone}, name: ${senderName}`);
      user = await this.ensureUserProfile(phoneNumber, senderName);
    }

    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date()) {
      console.log(`Plan expired for user ${phone}`);
      await this.sendText({
        phone,
        message: 'Seu plano venceu. Por favor, renove sua assinatura para continuar utilizando o serviço. Link: https://aurafit.ia.br',
      });
      return;
    }

    // 2. Account Active
    if (!user.isActive) {
      console.log(`Account deactivated for user ${phone}`);
      await this.sendText({
        phone,
        message: 'Sua conta está desativada. Para reativar, faça login novamente no sistema através do site. Link: https://aurafit.ia.br',
      });
      return;
    }

    // 3. Debounce
    const now = Date.now();
    const lastProcessed = this.lastMessageProcessed.get(phone) || 0;
    const debounceMs = 2000;
    if (now - lastProcessed < debounceMs) {
      console.log(`Ignoring message from ${phone} - sent too quickly`);
      return;
    }
    this.lastMessageProcessed.set(phone, now);

    console.log(`Processing message from ${phone}: ${textMessage || '[Image/Other]'}`);

    // If it's not text and not image, maybe ignore?
    if (!textMessage && !imageUrl) {
      // Just ignore
      return;
    }

    // 4. GPT Response
    try {
      const response = await this.gptService.generateResponse(
        textMessage || 'Analise esta imagem (Image not supported in migration yet)',
        phone,
        imageUrl || undefined,
      );

      const isErrorMessage = response.includes('Aguarde um momento') ||
        response.includes('problema temporário') ||
        response.includes('dificuldades técnicas');

      if (isErrorMessage) {
        const lastError = this.lastErrorSent.get(phone) || 0;
        const errorCooldown = 30 * 1000;

        if (now - lastError < errorCooldown) {
          console.log(`Suppressing error message for ${phone} - cooldown active`);
          return;
        }
        this.lastErrorSent.set(phone, now);
      }

      await this.sendText({ phone, message: response });
    } catch (error) {
      console.error('Error generating AI response for WhatsApp:', error);
      const lastError = this.lastErrorSent.get(phone) || 0;
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
  }

  /**
   * Verification endpoint for Meta Webhook
   */
  verifyWebhook(query: Record<string, string>) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Webhook verified successfully.');
      return challenge; // Return plain text challenge
    } else {
      throw new BadRequestException('Invalid verification token');
    }
  }

  /**
   * Send text message via Meta Graph API
   */
  async sendText(dto: CreateWhatsappDto): Promise<any> {
    this.ensureConfigured();

    const body = {
      messaging_product: 'whatsapp',
      to: dto.phone,
      type: 'text',
      text: { body: dto.message },
    };

    try {
      const res = await fetch(this.graphApiUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Meta API error: ${res.status} - ${text}`);
        // Log but maybe rethrow friendly?
        throw new BadRequestException(`Meta API error: ${text}`);
      }

      const result = await res.json();
      console.log('WhatsApp message sent (Meta)', {
        phone: dto.phone,
        messageId: result?.messages?.[0]?.id,
      });
      return result;
    } catch (error) {
      this.logger.error('Failed to send message via Meta API', error);
      throw error;
    }
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
