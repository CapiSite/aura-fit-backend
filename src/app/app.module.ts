import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import telegramConfig from 'src/config/telegram.config';
import geminiConfig from 'src/config/gemini.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from 'src/telegram/telegram.module';
import { GptModule } from 'src/gpt/gpt.module';
import { GeminiModule } from 'src/gemini/gemini.module';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import { WorkoutsModule } from 'src/workouts/workouts.module';
import { NutritionModule } from 'src/nutrition/nutrition.module';
import { PrismaModule } from 'src/prisma_connection/prisma.module';


@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [telegramConfig, geminiConfig],
    }),
    TelegramModule,
    //GptModule,
    GeminiModule,
    AuthModule,
    UsersModule,
    WorkoutsModule,
    NutritionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
