import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma_connection/prisma.service';
import { EmailService } from '../common/email/email.service';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from '../common/security/bcrypt';
import { SubscriptionPlan } from '@prisma/client';
import {
  TOKEN_EXPIRATION,
  TOKEN_SECURITY,
  GENERIC_MESSAGES
} from './constants/security.constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService
  ) { }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private get passwordPepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER') ?? 'dev-password-pepper'
  }

  private signToken(payload: any): string {
    const secret = this.config.get<string>('AUTH_SECRET') ?? 'dev-secret'
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
    return `${data}.${sig}`
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(TOKEN_SECURITY.RANDOM_BYTES).toString(TOKEN_SECURITY.ENCODING)
  }

  // ========================================
  // AUTHENTICATION
  // ========================================

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
          isActive: true,     // Reativa a conta se estiver desativada
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
    const user = await this.prisma.userProfile.findFirst({
      where: { email } as any,
      select: {
        id: true,
        email: true,
        cpf: true,
        passwordHash: true,
        role: true,
        isActive: true,
      }
    })

    if (!user || !user.passwordHash) throw new UnauthorizedException('Credenciais invalidas')

    // Verifica se a conta está ativa
    if (!user.isActive) {
      throw new UnauthorizedException('Conta desativada. Entre em contato com o suporte para reativar.')
    }

    const ok = await verifyPassword(password, user.passwordHash, this.passwordPepper)
    if (!ok) throw new UnauthorizedException('Credenciais invalidas')

    const exp = Date.now() + TOKEN_EXPIRATION.AUTH
    const role = (user as any).role ?? 'USER'
    const token = this.signToken({ email, cpf: user.cpf, role, exp })
    return { token, role }
  }

  // ========================================
  // ACCOUNT RECOVERY (Reativação)
  // ========================================

  async requestReactivation(email: string) {
    if (!email) throw new BadRequestException('E-mail e obrigatorio')

    const user = await this.prisma.userProfile.findFirst({
      where: { email } as any,
      select: { id: true, email: true, name: true, isActive: true }
    })

    // Não revela se usuário existe por segurança
    if (!user) {
      return { ok: true, message: GENERIC_MESSAGES.REACTIVATION_SENT }
    }

    // Se conta já está ativa, não envia email
    if (user.isActive) {
      return { ok: true, message: GENERIC_MESSAGES.REACTIVATION_SENT }
    }

    // Gera token único e seguro
    const token = this.generateSecureToken()
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION.REACTIVATION)

    // Salva token no banco
    await this.prisma.reactivationToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      }
    })

    // Envia email com o link de reativação
    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3001'
    const reactivationLink = `${frontendUrl}/reativate?token=${token}`

    try {
      if (user.email) {
        await this.emailService.sendReactivationEmail(user.email, user.name, reactivationLink)
      }
    } catch (error) {
      console.error('[REACTIVATION] Erro ao enviar email:', error)
      // Continua mesmo se email falhar
    }

    console.log(`[REACTIVATION] Token gerado para ${email}: ${token}`)

    return {
      ok: true,
      message: 'E-mail de reativacão enviado',
      // APENAS PARA DEV - REMOVER EM PRODUÇÃO
      devToken: token
    }
  }

  async confirmReactivation(token: string) {
    if (!token) throw new BadRequestException('Token invalido')

    const reactivationToken = await this.prisma.reactivationToken.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            cpf: true,
            role: true,
            isActive: true
          }
        }
      }
    })

    if (!reactivationToken) {
      throw new UnauthorizedException('Token invalido ou expirado')
    }

    if (reactivationToken.used) {
      throw new UnauthorizedException('Token ja utilizado')
    }

    if (reactivationToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expirado')
    }

    // Reativa a conta
    await this.prisma.userProfile.update({
      where: { id: reactivationToken.userId },
      data: { isActive: true }
    })

    // Marca token como usado
    await this.prisma.reactivationToken.update({
      where: { token },
      data: { used: true }
    })

    console.log(`[AUDIT] Conta reativada via token: user ID ${reactivationToken.userId}`)

    // Gera token de autenticação
    const exp = Date.now() + TOKEN_EXPIRATION.AUTH
    const authToken = this.signToken({
      email: reactivationToken.user.email,
      cpf: reactivationToken.user.cpf,
      role: reactivationToken.user.role,
      exp
    })

    return {
      token: authToken,
      role: reactivationToken.user.role,
      message: 'Conta reativada com sucesso!'
    }
  }

  // ========================================
  // PASSWORD RECOVERY (Reset de Senha)
  // ========================================

  async requestPasswordReset(email: string) {
    if (!email) throw new BadRequestException('E-mail e obrigatorio')

    const user = await this.prisma.userProfile.findFirst({
      where: { email } as any,
      select: { id: true, email: true, name: true }
    })

    // Não revela se usuário existe por segurança
    if (!user || !user.email) {
      return { ok: true, message: GENERIC_MESSAGES.PASSWORD_RESET_SENT }
    }

    // Gera token único e seguro
    const token = this.generateSecureToken()
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION.PASSWORD_RESET)

    // Salva token no banco
    await this.prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      }
    })

    // Envia email com o link de reset
    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3001'
    const resetLink = `${frontendUrl}/reset-password?token=${token}`

    try {
      await this.emailService.sendPasswordResetEmail(user.email, user.name, resetLink)
      this.logger.log(`[PASSWORD_RESET] Email sent to ${email}`)
    } catch (error) {
      this.logger.error(`[PASSWORD_RESET] Failed to send email to ${email}`, error)
      // Continua mesmo se email falhar
    }

    return {
      ok: true,
      message: 'E-mail de recuperacao enviado',
      // APENAS PARA DEV - REMOVER EM PRODUÇÃO
      devToken: token
    }
  }

  async confirmPasswordReset(token: string, newPassword: string) {
    if (!token) throw new BadRequestException('Token invalido')
    if (!newPassword) throw new BadRequestException('Nova senha e obrigatoria')

    // Validação de senha forte
    if (newPassword.length < 8) {
      throw new BadRequestException('Senha deve ter no minimo 8 caracteres')
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      throw new BadRequestException('Senha deve conter letras maiusculas, minusculas e numeros')
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    })

    if (!resetToken) {
      this.logger.warn(`[PASSWORD_RESET] Invalid token attempt`)
      throw new UnauthorizedException('Token invalido ou expirado')
    }

    if (resetToken.used) {
      this.logger.warn(`[PASSWORD_RESET] Used token reuse attempt: user ID ${resetToken.userId}`)
      throw new UnauthorizedException('Token ja utilizado')
    }

    if (resetToken.expiresAt < new Date()) {
      this.logger.warn(`[PASSWORD_RESET] Expired token attempt: user ID ${resetToken.userId}`)
      throw new UnauthorizedException('Token expirado')
    }

    // Atualiza a senha
    const newHash = await hashPassword(newPassword, this.passwordPepper)

    await this.prisma.userProfile.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newHash }
    })

    // Marca token como usado
    await this.prisma.passwordResetToken.update({
      where: { token },
      data: { used: true }
    })

    this.logger.log(`[AUDIT] Password reset successful: user ID ${resetToken.userId}`)

    return {
      ok: true,
      message: 'Senha redefinida com sucesso!'
    }
  }
}
