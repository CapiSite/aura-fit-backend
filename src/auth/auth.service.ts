import { Injectable, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma_connection/prisma.service';
import crypto from 'crypto'
import { hashPassword, verifyPassword } from '../common/security/bcrypt';
import { SubscriptionPlan } from '@prisma/client'

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) { }

  private get passwordPepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER') ?? 'dev-password-pepper'
  }

  private signToken(payload: any): string {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret'
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
    return `${data}.${sig}`
  }

  async register(email: string, password: string, name?: string, cpf?: string, phone?: string, _subscriptionPlan?: string) {
    if (!email || !password) throw new BadRequestException('E-mail e senha sao obrigatorios')

    const cleanCpf = (cpf || '').replace(/\D/g, '')
    const cleanPhone = (phone || '').replace(/\D/g, '')
    const displayName = name?.trim() || email.split('@')[0] || 'Usuario'
    const hash = await hashPassword(password, this.passwordPepper)

    try {
      // Verifica se já existe por telefone, email ou CPF
      const existing = await this.prisma.userProfile.findFirst({
        where: {
          OR: [
            { email },
            { cpf: cleanCpf },
            { phoneNumber: cleanPhone }
          ].filter(condition => Object.values(condition)[0]) // Remove condições vazias
        } as any,
      })

      // Se existe, atualiza apenas campos vazios + adiciona senha
      if (existing) {
        const updateData: any = {
          passwordHash: hash, // Sempre atualiza a senha
        };

        // Só atualiza se o campo estava vazio
        if (!existing.name && displayName) {
          updateData.name = displayName;
        }
        if (!existing.cpf && cleanCpf) {
          updateData.cpf = cleanCpf;
        }
        if (!existing.email || existing.email.includes('@aura.local')) {
          updateData.email = email;
        }
        if (!existing.phoneNumber || !cleanPhone) {
          updateData.phoneNumber = cleanPhone || existing.phoneNumber;
        }

        const updated = await this.prisma.userProfile.update({
          where: { id: existing.id },
          data: updateData,
        });

        const exp = Date.now() + 24 * 60 * 60 * 1000
        const role = (updated as any).role ?? 'USER'
        const token = this.signToken({ email: updated.email, cpf: updated.cpf, role, exp })
        return { token, role }
      }

      // Se não existe, cria novo
      const trialDays = 3
      const trialExpiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
      const created = await this.prisma.userProfile.create({
        data: {
          name: displayName,
          cpf: cleanCpf || null,
          email,
          phoneNumber: cleanPhone || '',
          subscriptionPlan: SubscriptionPlan.FREE,
          subscriptionExpiresAt: trialExpiresAt,
          isPaymentActive: false,
          requestsToday: 0,
          requestsLastReset: new Date(),
          passwordHash: hash,
        },
      })
      const exp = Date.now() + 24 * 60 * 60 * 1000
      const role = (created as any).role ?? 'USER'
      const token = this.signToken({ email, cpf: created.cpf, role, exp })
      return { token, role }
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('CPF, email ou telefone ja cadastrado')
      }
      throw new BadRequestException('Erro ao registrar usuario')
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.userProfile.findFirst({ where: { email } as any })
    if (!user || !user.passwordHash) throw new UnauthorizedException('Credenciais invalidas')
    const ok = await verifyPassword(password, user.passwordHash, this.passwordPepper)
    if (!ok) throw new UnauthorizedException('Credenciais invalidas')
    const exp = Date.now() + 24 * 60 * 60 * 1000
    const role = (user as any).role ?? 'USER'
    const token = this.signToken({ email, cpf: user.cpf, role, exp })
    return { token, role }
  }

  async forgotPassword(email: string) {
    if (!email) throw new BadRequestException('E-mail e obrigatorio')
    // Busca o usuario; resposta generica para nao expor existencia
    await this.prisma.userProfile.findFirst({ where: { email } as any })
    return { ok: true, message: 'Se o e-mail existir, enviamos instrucoes' }
  }
}
