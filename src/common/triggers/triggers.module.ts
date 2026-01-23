import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma_connection/prisma.module';
import { ReminderService } from './reminder.service';
import { MorningGreetingService } from './morning-greeting.service';
import { PixReminderService } from './pix-reminder.service';
import { ConversionService } from './conversion.service';
import { TimezoneService } from '../services/timezone.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
  ],
  providers: [
    TimezoneService,
    ReminderService,
    MorningGreetingService,
    PixReminderService,
    ConversionService,
  ],
  exports: [
    TimezoneService,
    ReminderService,
    MorningGreetingService,
    PixReminderService,
    ConversionService,
  ],
})
export class TriggersModule { }
