import { registerAs } from '@nestjs/config';

export default registerAs('gpt', () => ({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.GPT_API_KEY ?? '',
  model: process.env.OPENAI_MODEL ?? process.env.GPT_MODEL ?? 'gpt-4o-mini',
}));
