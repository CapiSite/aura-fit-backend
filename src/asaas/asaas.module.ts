import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma_connection/prisma.module';
import { UsersModule } from '../users/users.module';
import { AuthGuard } from '../common/guards/auth.guard';
import { AsaasService } from './asaas.service';
import { AsaasController } from './asaas.controller';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule],
  controllers: [AsaasController],
  providers: [AsaasService, AuthGuard],
  exports: [AsaasService],
})
export class AsaasModule {}
