import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GptService } from './gpt.service';
import { GptController } from './gpt.controller';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { McpModule } from '../mcp/mcp.module';

@Module({
  controllers: [GptController],
  providers: [GptService],
  imports: [ConfigModule, TelegramModule, UsersModule, McpModule],
  exports: [GptService],
})
export class GptModule { }
