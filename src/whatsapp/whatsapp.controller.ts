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
    return this.whatsappService.getChatMessages(phone);
  }

  @Get('qr')
  getQr() {
    return this.whatsappService.getQrCodeImage();
  }
}
