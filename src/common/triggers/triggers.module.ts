import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from '../../users/users.module';
import { PrismaModule } from '../../prisma_connection/prisma.module';
import { ReminderService } from './reminder.service';
import { MorningGreetingService } from './morning-greeting.service';
import { PixReminderService } from './pix-reminder.service';
import { ConversionService } from './conversion.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    UsersModule,
    PrismaModule,
  ],
  providers: [ReminderService, MorningGreetingService, PixReminderService, ConversionService],
  exports: [ReminderService, MorningGreetingService, PixReminderService, ConversionService],
})
export class TriggersModule { }
