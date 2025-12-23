import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import gptConfig from '../config/gpt.config';
import whatsappConfig from '../config/whatsapp.config';
import asaasConfig from '../config/asaas.config';
import emailConfig from '../config/email.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GptModule } from '../gpt/gpt.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma_connection/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AsaasModule } from '../asaas/asaas.module';
import { ConfigValidationService } from '../common/config/config-validation.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        gptConfig,
        whatsappConfig,
        asaasConfig,
        emailConfig,
      ],
    }),

    GptModule,
    AuthModule,
    UsersModule,
    WhatsappModule,
    AsaasModule,
  ],
  controllers: [AppController],
  providers: [AppService, ConfigValidationService],
})
export class AppModule { }
