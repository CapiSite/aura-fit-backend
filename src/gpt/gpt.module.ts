import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GptService } from './gpt.service';
import { GptController } from './gpt.controller';
import { TelegramModule } from 'src/telegram/telegram.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  controllers: [GptController],
  providers: [GptService],
  imports: [ConfigModule, TelegramModule, UsersModule],
})
export class GptModule {}
