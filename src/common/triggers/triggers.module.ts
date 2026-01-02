import { Module } from '@nestjs/common';
import { UsersModule } from '../../users/users.module';
import { PrismaModule } from '../../prisma_connection/prisma.module';
import { ReminderService } from './reminder.service';
import { MorningGreetingService } from './morning-greeting.service';

@Module({
  imports: [UsersModule, PrismaModule],
  providers: [ReminderService, MorningGreetingService],
  exports: [ReminderService, MorningGreetingService],
})
export class TriggersModule { }
