import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import telegramConfig from 'src/config/telegram.config';
import gptConfig from 'src/config/gpt.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from 'src/telegram/telegram.module';
import { GptModule } from 'src/gpt/gpt.module';
// import { GeminiModule } from 'src/gemini/gemini.module';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';

import { PrismaModule } from 'src/prisma_connection/prisma.module';


@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [telegramConfig, gptConfig],
    }),
    TelegramModule,
    GptModule,
    // GeminiModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
