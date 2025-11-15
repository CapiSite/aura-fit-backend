// telegram.service.ts
import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
//import { AiService } from '../ai/ai.service';

@Injectable()
export class TelegramService {
  private bot: TelegramBot;

  constructor() { //private readonly ai: AiService) {
    this.bot = new TelegramBot(process.env.TELEGTRAM_BOT_TOKEN, {
      polling: true,
    });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text || '';

      // Envia para o Agent da OpenAI
      //const response = await this.ai.askAgent(text);
      const response = 'teste';
      console.log(response);

      // Manda de volta
      this.bot.sendMessage(chatId, response);
    });
  }
}
