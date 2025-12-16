import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma_connection/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from '../common/guards/auth.guard';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [UsersController],
  providers: [UsersService, AuthGuard],
  exports: [UsersService],
})
export class UsersModule { }
