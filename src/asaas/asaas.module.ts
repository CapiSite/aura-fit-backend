import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from 'src/prisma_connection/prisma.module';
import { UsersModule } from 'src/users/users.module';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AsaasService } from './asaas.service';
import { AsaasController } from './asaas.controller';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule],
  controllers: [AsaasController],
  providers: [AsaasService, AuthGuard],
  exports: [AsaasService],
})
export class AsaasModule {}
