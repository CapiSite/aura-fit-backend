import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateWhatsappDto } from './dto/create-whatsapp.dto';
import { WebhookEventDto } from './dto/webhook-event.dto';
import { GptService } from 'src/gpt/gpt.service';
import { PrismaService } from 'src/prisma_connection/prisma.service';

type ZapiSendTextResponse = { zaapId: string; messageId: string };

@Injectable()
export class WhatsappService {
  private readonly instanceId: string;
  private readonly token: string;
  private readonly clientToken: string;
  private readonly webhookMessages = new Map<string, any[]>();
  private readonly processedMessages = new Map<string, number>(); // messageKey -> timestamp

  constructor(
    private readonly configService: ConfigService,
    private readonly gptService: GptService,
    private readonly prisma: PrismaService,
  ) {
    this.instanceId = this.configService.get<string>('whatsapp.instanceId') ?? '';
    this.token = this.configService.get<string>('whatsapp.token') ?? '';
    this.clientToken = this.configService.get<string>('whatsapp.clientToken') ?? '';
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

  /**
   * Z-API sometimes wraps the messages array inside different envelope keys.
   * This normalizer keeps the controller contract consistent by always
   * returning an array to the caller.
   */
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

  private buildMessageKey(phone: string, payload: WebhookEventDto): string | null {
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

  private async isAuthorizedPhone(phone: string): Promise<boolean> {
    const chatId = this.tryParseChatId(phone);
    if (!chatId) {
      return false;
    }

    const profile = await this.prisma.userProfile.findUnique({
      where: { chatId },
      select: { chatId: true },
    });

    return Boolean(profile);
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

    // Check if it is a text message from user
    const textMessage = payload?.message?.text?.message || payload?.text?.message;
    const isFromMe = payload?.message?.fromMe || payload?.fromMe;

    if (phone && textMessage && !isFromMe) {
      const messageKey = this.buildMessageKey(phone, payload);
      if (messageKey) {
        if (this.processedMessages.has(messageKey)) {
          console.log('Ignoring duplicated WhatsApp webhook', { phone, messageKey });
          return { received: true, duplicated: true };
        }
        this.registerMessageKey(messageKey);
      }

      const authorized = await this.isAuthorizedPhone(phone);
      if (!authorized) {
        console.log(`Ignoring message from unregistered phone: ${phone}`);
        return { received: true };
      }
      console.log(`Received message from ${phone}: ${textMessage}`);
      try {
        const response = await this.gptService.generateResponse(textMessage, phone);
        await this.sendText({ phone, message: response });
      } catch (error) {
        console.error('Error generating GPT response for WhatsApp:', error);
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
