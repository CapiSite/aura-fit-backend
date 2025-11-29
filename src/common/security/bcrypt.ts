import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(_scrypt);

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: buf.toString('hex') };
}

export async function verifyPassword(password: string, hashHex: string, salt: string): Promise<boolean> {
  if (!salt || !hashHex) return false;
  const buf = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hashHex, 'hex');
  if (stored.length !== buf.length) return false;
  return timingSafeEqual(stored, buf);
}