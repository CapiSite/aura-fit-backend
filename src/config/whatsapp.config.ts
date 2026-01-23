import { registerAs } from '@nestjs/config';

const sanitize = (value: string) =>
  value.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').replace(/[`\s]/g, '');

export default registerAs('whatsapp', () => {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID ? sanitize(process.env.WHATSAPP_PHONE_NUMBER_ID) : '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ? sanitize(process.env.WHATSAPP_ACCESS_TOKEN) : '';
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ? sanitize(process.env.WHATSAPP_VERIFY_TOKEN) : '';

  return {
    phoneId,
    accessToken,
    verifyToken,
  };
});