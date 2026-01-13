import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma_connection/prisma.module';
import { UsersModule } from '../users/users.module';
import { AuthGuard } from '../common/guards/auth.guard';
import { AsaasController } from './asaas.controller';
import { AsaasApiClient } from './services/asaas-api.client';
import { AsaasCustomerService } from './services/asaas-customer.service';
import { AsaasPaymentService } from './services/asaas-payment.service';
import { AsaasSubscriptionService } from './services/asaas-subscription.service';
import { AsaasWebhookService } from './services/asaas-webhook.service';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule],
  controllers: [AsaasController],
  providers: [
    AsaasApiClient,
    AsaasCustomerService,
    AsaasPaymentService,
    AsaasSubscriptionService,
    AsaasWebhookService,
    AuthGuard,
  ],
  exports: [
    AsaasApiClient,
    AsaasCustomerService,
    AsaasPaymentService,
    AsaasSubscriptionService,
    AsaasWebhookService,
  ],
})
export class AsaasModule { }
