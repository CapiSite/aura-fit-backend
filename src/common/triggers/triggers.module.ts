import { Module } from '@nestjs/common';
import { UsersModule } from '../../users/users.module';
import { PrismaModule } from '../../prisma_connection/prisma.module';
import { ReminderService } from './reminder.service';

@Module({
  imports: [UsersModule, PrismaModule],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class TriggersModule { }
