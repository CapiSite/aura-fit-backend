import { registerAs } from '@nestjs/config';

const sanitize = (value: string) =>
  value.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').replace(/[`\s]/g, '');

export default registerAs('whatsapp', () => {
  const instanceId = process.env.ZAPI_INSTANCE_ID ? sanitize(process.env.ZAPI_INSTANCE_ID) : '';
  const token = process.env.ZAPI_TOKEN ? sanitize(process.env.ZAPI_TOKEN) : '';
  const clientToken = process.env.ZAPI_CLIENT_TOKEN ? sanitize(process.env.ZAPI_CLIENT_TOKEN) : '';

  return {
    instanceId,
    token,
    clientToken,
  };
});