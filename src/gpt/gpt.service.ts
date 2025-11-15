import { Injectable } from '@nestjs/common';
import { TelegramService } from 'src/telegram/telegram.service';

@Injectable()
export class GptService {
  constructor(private readonly telegramService: TelegramService) {

  }
}
