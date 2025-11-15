import { Module } from '@nestjs/common';
import { GptService } from './gpt.service';
import { GptController } from './gpt.controller';
import { TelegramModule } from 'src/telegram/telegram.module';

@Module({
  controllers: [GptController],
  providers: [GptService],
  imports: [TelegramModule],
})
export class GptModule {}
