import { Controller, Get, Post, Body } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { CreateWhatsappDto } from './dto/create-whatsapp.dto';
import { WebhookEventDto } from './dto/webhook-event.dto';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post()
  sendText(@Body() createWhatsappDto: CreateWhatsappDto) {
    return this.whatsappService.sendText(createWhatsappDto);
  }

  @Post('webhook')
  handleWebhook(@Body() payload: any) {
    console.log(
      'WhatsApp webhook payload (RAW):',
      JSON.stringify(payload, null, 2),
    );
    return this.whatsappService.handleWebhook(payload);
  }

  @Get('qr')
  getQr() {
    console.log('WhatsApp getQr request');
    return this.whatsappService.getQrCodeImage();
  }
}
