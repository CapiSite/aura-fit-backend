export interface ReminderTransport {
  name: string;
  send(chatId: string, message: string): Promise<void>;
}
