import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from '../../users/users.module';
import { PrismaModule } from '../../prisma_connection/prisma.module';
import { ReminderService } from './reminder.service';
import { MorningGreetingService } from './morning-greeting.service';
import { PixReminderService } from './pix-reminder.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    UsersModule,
    PrismaModule,
  ],
  providers: [ReminderService, MorningGreetingService, PixReminderService],
  exports: [ReminderService, MorningGreetingService, PixReminderService],
})
export class TriggersModule { }
