import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
//mport { TelegramUpdate } from './telegram.update';

@Module({
  imports: [
    ConfigModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN')
          ?? configService.get<string>('TELEGTRAM_BOT_TOKEN');

        if (!token) {
          throw new Error('Telegram bot token is not configured');
        }

        return { token };
      },
    }),
  ],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramModule],
})
export class TelegramModule {}
