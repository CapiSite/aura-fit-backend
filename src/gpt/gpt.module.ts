import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GptService } from './gpt.service';
import { GptController } from './gpt.controller';
import { TelegramModule } from 'src/telegram/telegram.module';

@Module({
  controllers: [GptController],
  providers: [GptService],
  imports: [ConfigModule, TelegramModule],
})
export class GptModule {}
