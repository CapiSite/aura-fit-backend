import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { CreateTelegramDto } from './dto/create-telegram.dto';
import { UpdateTelegramDto } from './dto/update-telegram.dto';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) { }


}
