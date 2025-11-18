import { registerAs } from '@nestjs/config';

export default registerAs('gpt', () => ({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.GPT_API_KEY ?? '',
  assistantId: process.env.OPENAI_ASST_ID ?? process.env.OPENAI_ASSISTANT_ID ?? '',
  model: process.env.OPENAI_MODEL ?? process.env.GPT_MODEL ?? 'gpt-4o-mini',
}));
