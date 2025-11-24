import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateWhatsappDto } from './dto/create-whatsapp.dto';

type ZapiSendTextResponse = { zaapId: string; messageId: string };

@Injectable()
export class WhatsappService {
  private readonly instanceId: string;
  private readonly token: string;
  private readonly clientToken: string;

  constructor(private readonly configService: ConfigService) {
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
    this.ensureConfigured();
    const res = await fetch(`${this.baseUrl}/chat-messages/${phone}`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(text || `Z-API error ${res.status}`);
    }
    const payload = await res.json();
    const data = this.normalizeMessagesResponse(payload);
    console.log('WhatsApp messages received', {
      phone,
      count: Array.isArray(data) ? data.length : 0,
    });
    return data;
  }
}
