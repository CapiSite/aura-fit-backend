import { ConfigService } from '@nestjs/config';
import { TelegramService } from 'src/telegram/telegram.service';
export declare class GptService {
    private readonly configService;
    private readonly telegramService;
    private readonly logger;
    private readonly client;
    private readonly model;
    constructor(configService: ConfigService, telegramService: TelegramService);
    private handleIncomingMessage;
    private generateResponse;
}
