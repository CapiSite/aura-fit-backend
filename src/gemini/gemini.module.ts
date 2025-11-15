import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GeminiController } from './gemini.controller';
import { TelegramModule } from 'src/telegram/telegram.module';

@Module({
  controllers: [GeminiController],
  providers: [GeminiService],
  imports: [TelegramModule],
})
export class GeminiModule {}
