import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from 'src/prisma_connection/prisma.service'
import crypto from 'crypto'
import { hashPassword, verifyPassword } from 'src/common/security/bcrypt'

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private get passwordPepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER') ?? 'dev-password-pepper'
  }

  private signToken(payload: any): string {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret'
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
    return `${data}.${sig}`
  }

  private verifyToken(token: string): any | null {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret'
    const [data, sig] = token.split('.')
    if (!data || !sig) return null
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex')
    if (expected !== sig) return null
    try {
      return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    } catch {
      return null
    }
  }

  async register(email: string, password: string) {
    if (!email || !password) throw new BadRequestException('E-mail e senha são obrigatórios')
    const user = await this.prisma.userProfile.findFirst({ where: { email } as any })
    if (!user) throw new BadRequestException('Usuário não encontrado para este e-mail')
    const hash = await hashPassword(password, this.passwordPepper)
    await this.prisma.userProfile.updateMany({ where: { email } as any, data: { passwordHash: hash } })
    return { ok: true }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.userProfile.findFirst({ where: { email } as any })
    if (!user || !user.passwordHash) throw new UnauthorizedException('Credenciais inválidas')
    const ok = await verifyPassword(password, user.passwordHash, this.passwordPepper)
    if (!ok) throw new UnauthorizedException('Credenciais inválidas')
    const exp = Date.now() + 24 * 60 * 60 * 1000
    const role = (user as any).role ?? 'USER'
    const token = this.signToken({ email, cpf: user.cpf, role, exp })
    return { token, role }
  }
}
