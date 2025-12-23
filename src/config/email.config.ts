import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  host: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT ?? '587', 10),
  user: process.env.EMAIL_USER ?? '',
  pass: process.env.EMAIL_PASS ?? '',
  secure: process.env.EMAIL_SECURE === 'true', // true para porta 465
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
}));
