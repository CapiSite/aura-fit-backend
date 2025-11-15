import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma_connection/prisma.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
