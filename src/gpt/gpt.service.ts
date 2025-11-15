import { Injectable } from '@nestjs/common';
import { CreateGptDto } from './dto/create-gpt.dto';
import { UpdateGptDto } from './dto/update-gpt.dto';
import { TelegramService } from 'src/telegram/telegram.service';

@Injectable()
export class GptService {
  constructor(private readonly telegramService: TelegramService) {}

  create(_createGptDto: CreateGptDto) {
    return 'This action adds a new gpt';
  }

  findAll() {
    return `This action returns all gpt`;
  }

  findOne(id: number) {
    return `This action returns a #${id} gpt`;
  }

  update(id: number, _updateGptDto: UpdateGptDto) {
    return `This action updates a #${id} gpt`;
  }

  remove(id: number) {
    return `This action removes a #${id} gpt`;
  }
}
