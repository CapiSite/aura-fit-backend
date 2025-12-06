import { Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { PrismaModule } from 'src/prisma_connection/prisma.module';
import { ReminderService } from './reminder.service';

@Module({
  imports: [UsersModule, PrismaModule],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class TriggersModule {}
