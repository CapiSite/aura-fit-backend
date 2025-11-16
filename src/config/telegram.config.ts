import { registerAs } from '@nestjs/config';

const sanitizeToken = (value: string) =>
  value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^'|'$/g, '')
    .replace(/[`\s]/g, '')
    .replace(/^https?:\/\/api\.telegram\.org\/bot/i, '')
    .replace(/^bot:/i, '');

export default registerAs('telegram', () => {
  const raw = process.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_TOKEN ?? '';
  const token = raw ? sanitizeToken(raw) : '';

  return {
    token,
  };
});
