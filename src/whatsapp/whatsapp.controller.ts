import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { CreateWhatsappDto } from './dto/create-whatsapp.dto';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) { }

  @Post()
  sendText(@Body() createWhatsappDto: CreateWhatsappDto) {
    return this.whatsappService.sendText(createWhatsappDto);
  }

  @Get('messages/:phone')
  getMessages(@Param('phone') phone: string) {
    console.log('WhatsApp getMessages request', { phone });
    return this.whatsappService.getChatMessages(phone);
  }

  @Get('messages')
  getMessagesDefault() {
    console.log('WhatsApp getMessages default request');
    return this.whatsappService.getChatMessages('');
  }

  @Get('qr')
  getQr() {
    console.log('WhatsApp getQr request');
    return this.whatsappService.getQrCodeImage();
  }
}
