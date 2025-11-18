import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { TelegramService } from './telegram.service';


@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) { }


}
