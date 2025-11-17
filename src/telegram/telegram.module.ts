import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { PromptInterceptor } from 'src/common/interceptors/promp.interceptor';
import { NutritionModule } from 'src/nutrition/nutrition.module';
import { WorkoutsModule } from 'src/workouts/workouts.module';

@Module({
  imports: [ConfigModule, NutritionModule, WorkoutsModule],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    PromptInterceptor,
    {
      provide: 'MESSAGE_INTERCEPTORS',
      useFactory: (prompt: PromptInterceptor) => [prompt],
      inject: [PromptInterceptor],
    },
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
