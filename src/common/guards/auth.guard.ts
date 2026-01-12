import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma_connection/prisma.service';
import crypto from 'crypto';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) { }

  private verifyToken(token: string): { cpf: string; exp: number; role?: string } | null {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret';
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
    if (expected !== sig) return null;
    try {
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
      if (!payload?.cpf || !payload?.exp || Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    const token = auth.substring('Bearer '.length).trim();
    const payload = this.verifyToken(token);
    if (!payload) throw new UnauthorizedException('Token inválido ou expirado');

    const user = await this.prisma.userProfile.findUnique({ where: { cpf: payload.cpf } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');

    req['user'] = { cpf: payload.cpf, role: user.role };
    return true;
  }
}
