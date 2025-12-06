import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';

import { GptModule } from 'src/gpt/gpt.module';
import { TriggersModule } from 'src/common/triggers/triggers.module';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService],
  imports: [GptModule, TriggersModule],
})
export class WhatsappModule { }
