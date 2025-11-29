import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from 'src/common/security/bcrypt';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) { }



  private signToken(payload: any): string {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret';
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return `${data}.${sig}`;
  }

  private verifyToken(token: string): any | null {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret';
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
    if (expected !== sig) return null;
    try {
      return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  async register(cpf: string, password: string) {
    if (!cpf || !password) throw new BadRequestException('CPF e senha são obrigatórios');
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
    if (!user) throw new BadRequestException('Usuário não encontrado para este CPF');
    const { salt, hash } = await hashPassword(password);
    await this.prisma.userProfile.update({ where: { cpf }, data: { passwordSalt: salt, passwordHash: hash } });
    return { ok: true };
  }

  async login(cpf: string, password: string) {
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
    if (!user || !user.passwordSalt || !user.passwordHash) throw new UnauthorizedException('Credenciais inválidas');
    const ok = await verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');
    const exp = Date.now() + 24 * 60 * 60 * 1000;
    const token = this.signToken({ cpf, exp });
    return { token };
  }
}
