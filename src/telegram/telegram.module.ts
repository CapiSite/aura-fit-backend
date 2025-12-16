import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { PromptInterceptor } from '../common/interceptors/promp.interceptor';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [ConfigModule, UsersModule],
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
