import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';

import { GptModule } from '../gpt/gpt.module';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService],
  imports: [GptModule],
})
export class WhatsappModule { }
