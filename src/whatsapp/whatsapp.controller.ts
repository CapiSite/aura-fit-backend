import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { CreateWhatsappDto } from './dto/create-whatsapp.dto';
import { WebhookEventDto } from './dto/webhook-event.dto';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) { }

  @Post()
  sendText(@Body() createWhatsappDto: CreateWhatsappDto) {
    return this.whatsappService.sendText(createWhatsappDto);
  }

  @Get('webhook')
  verifyWebhook(@Query() query: Record<string, string>) {
    return this.whatsappService.verifyWebhook(query);
  }

  @Post('webhook')
  handleWebhook(@Body() payload: WebhookEventDto) {
    // Meta sends the payload in a specific structure
    return this.whatsappService.handleWebhook(payload);
  }
}
