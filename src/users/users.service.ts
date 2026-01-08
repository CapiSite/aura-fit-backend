import { Injectable, ConflictException, NotFoundException, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from '../prisma_connection/prisma.service';
import { SubscriptionPlan, UserProfile } from '@prisma/client';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { hashPassword, verifyPassword } from '../common/security/bcrypt';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) { }

  private get passwordPepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER') ?? 'dev-password-pepper';
  }

  async create(createUserDto: CreateUserDto) {
    const phoneNumber = String(createUserDto.phoneNumber);
    const plan = (createUserDto.subscriptionPlan ?? SubscriptionPlan.FREE) as SubscriptionPlan;
    const trialDays = 3;
    const trialExpiresAt =
      plan === SubscriptionPlan.FREE
        ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
        : null;

    // Verifica se usuário já existe
    const existing = await this.prisma.userProfile.findFirst({
      where: {
        OR: [
          { cpf: createUserDto.cpf },
          { phoneNumber },
          { email: createUserDto.email }
        ].filter(condition => Object.values(condition)[0]) // Remove null/undefined
      },
    });

    if (existing) {
      throw new ConflictException('CPF, email ou telefone ja cadastrado');
    }

    // Se NÃO existe, cria novo
    const data = {
      name: createUserDto.name,
      cpf: createUserDto.cpf ?? null,
      email: createUserDto.email ?? `${phoneNumber}@aura.local`,
      address: createUserDto.address,
      addressNumber: createUserDto.addressNumber,
      addressComplement: createUserDto.addressComplement,
      zipCode: createUserDto.zipCode,
      phoneNumber,
      subscriptionPlan: plan,
      ...(createUserDto.role ? { role: createUserDto.role } : {}),
      subscriptionExpiresAt: trialExpiresAt,
      isPaymentActive: false,
      requestsToday: 0,
      requestsLastReset: new Date(),
    };
    try {
      return await this.prisma.userProfile.create({ data });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('CPF ou telefone ja cadastrado');
      }
      throw new BadRequestException('Erro ao criar usuario');
    }
  }

  findAll() {
    try {
      return this.prisma.userProfile.findMany();
    } catch {
      throw new BadRequestException('Erro ao listar usuarios');
    }
  }

  async findOne(id: number) {
    try {
      const user = await this.prisma.userProfile.findUnique({ where: { id } });
      if (!user) throw new NotFoundException('Usuario nao encontrado');
      return user;
    } catch {
      throw new BadRequestException('Erro ao buscar usuario');
    }
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const data: any = { ...updateUserDto };
    try {
      return await this.prisma.userProfile.update({ where: { id }, data });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('CPF ou telefone ja cadastrado');
      }
      if (error?.code === 'P2025') {
        throw new NotFoundException('Usuario nao encontrado');
      }
      throw new BadRequestException('Erro ao atualizar usuario');
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.userProfile.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new NotFoundException('Usuario nao encontrado');
      }
      throw new BadRequestException('Erro ao remover usuario');
    }
  }

  async getStatsByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF nao informado');
    const user = await this.ensureDailyResetByCpf(cpf);
    if (!user) throw new NotFoundException('Usuario nao encontrado');
    const limits: Record<string, number> = { FREE: 20, PLUS: 25, PRO: 40 };
    const plan =
      ((user.subscriptionPlan as unknown as string) ?? 'FREE')
        .toString()
        .trim()
        .toUpperCase();
    const dailyLimit = limits[plan] ?? limits.FREE;
    const usedToday = user.requestsToday ?? 0;
    return {
      subscriptionPlan: plan,
      requestsLimitPerDay: dailyLimit,
      requestsToday: usedToday,
      requestsRemaining: Math.max(dailyLimit - usedToday, 0),
      requestsLastReset: user.requestsLastReset,
    };
  }

  async getUsageByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF nao informado');
    const user = await this.ensureDailyResetByCpf(cpf);
    if (!user) throw new NotFoundException('Usuario nao encontrado');

    const usage = await this.prisma.promptUsage.findMany({
      where: { userId: user.id },
      orderBy: { date: 'asc' },
      take: 60,
    });

    if (!usage.length) {
      return [
        {
          date: new Date().toISOString().slice(0, 10),
          count: Math.max(user.requestsToday ?? 0, 0),
        },
      ];
    }

    return usage.map((item) => ({
      date: item.date.toISOString().slice(0, 10),
      count: item.count ?? 0,
    }));
  }

  async getMeByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF nao informado');
    const user = await this.prisma.userProfile.findUnique({
      where: { cpf },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        cpf: true,
        email: true,
        subscriptionPlan: true,
        role: true,
        isPaymentActive: true,
        lastPaymentAt: true,
        subscriptionExpiresAt: true,
        waterReminderEnabled: true,
        waterReminderIntervalMinutes: true,
        address: true,
        addressNumber: true,
        addressComplement: true,
        zipCode: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario nao encontrado');
    const trialStatus = await this.resolveTrialStatus(user);
    return {
      ...user,
      trialEligible: trialStatus.trialEligible,
      trialActive: trialStatus.trialActive,
      trialExpired: trialStatus.trialExpired,
      trialEndsAt: trialStatus.trialEndsAt,
    };
  }

  async getInvoicesByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF nao informado');
    const user = await this.prisma.userProfile.findUnique({
      where: { cpf },
      select: { phoneNumber: true, id: true },
    });
    if (!user) throw new NotFoundException('Usuario nao encontrado');

    return this.prisma.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        plan: true,
        method: true,
        amount: true,
        invoiceUrl: true,
        bankSlipUrl: true,
        transactionReceiptUrl: true,
        pixQrCode: true,
        pixPayload: true,
        dueDate: true,
        createdAt: true,
        paidAt: true,
      },
    });
  }

  async startTrialByCpf(cpf: string, trialDays = 3) {
    if (!cpf) throw new BadRequestException('CPF nao informado');
    const user = await this.prisma.userProfile.findUnique({
      where: { cpf },
      select: {
        id: true,
        phoneNumber: true,
        cpf: true,
        subscriptionPlan: true,
        isPaymentActive: true,
        lastPaymentAt: true,
        subscriptionExpiresAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario nao encontrado');

    const trialStatus = await this.resolveTrialStatus(user);
    if (trialStatus.trialActive) {
      return { ok: true, status: 'ACTIVE', trialEndsAt: trialStatus.trialEndsAt };
    }
    if (!trialStatus.trialEligible) {
      throw new BadRequestException('Trial indisponivel para este usuario');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.userProfile.update({
      where: { cpf },
      data: {
        subscriptionPlan: SubscriptionPlan.FREE,
        isPaymentActive: false,
        subscriptionExpiresAt: expiresAt,
      },
      select: { subscriptionExpiresAt: true },
    });

    return { ok: true, status: 'ACTIVE', trialEndsAt: updated.subscriptionExpiresAt };
  }

  async updateProfileFromIA(
    chatId: string | number,
    data: Partial<UserProfile>,
  ): Promise<UserProfile> {
    const id = String(chatId);
    return this.prisma.userProfile.update({
      where: { phoneNumber: id },
      data,
    });
  }

  async processMessageAndUpdateProfile(
    message: string,
    profile: UserProfile,
  ): Promise<UserProfile> {
    // TODO: implement IA processing
    console.log('Processando mensagem no UsersService:', message);
    return profile;
  }

  private isSameUtcDay(a: Date, b: Date): boolean {
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

  private async ensureDailyResetByCpf(cpf: string): Promise<UserProfile> {
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
    if (!user) throw new NotFoundException('Usuario nao encontrado');

    const now = new Date();
    const last = user.requestsLastReset ?? now;
    if (this.isSameUtcDay(last, now)) {
      return user;
    }

    return this.prisma.userProfile.update({
      where: { cpf },
      data: { requestsToday: 0, requestsLastReset: now },
    });
  }

  async updateMeByCpf(cpf: string, dto: UpdateMeDto) {
    const user = await this.ensureDailyResetByCpf(cpf);
    const data: any = {};
    if (dto.name) data.name = dto.name.trim();
    if (dto.email) data.email = dto.email.trim();
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.addressNumber !== undefined) data.addressNumber = dto.addressNumber;
    if (dto.addressComplement !== undefined) data.addressComplement = dto.addressComplement;
    if (dto.zipCode !== undefined) data.zipCode = dto.zipCode;

    // Water reminder settings
    if (dto.waterReminderEnabled !== undefined) {
      data.waterReminderEnabled = dto.waterReminderEnabled;
    }
    if (dto.waterReminderIntervalMinutes !== undefined) {
      data.waterReminderIntervalMinutes = dto.waterReminderIntervalMinutes;
    }

    if (data.email) {
      const exists = await this.prisma.userProfile.findFirst({
        where: { email: data.email, NOT: { cpf } },
      });
      if (exists) throw new ConflictException('E-mail ja utilizado por outro usuario');
    }

    return this.prisma.userProfile.update({
      where: { cpf },
      data,
      select: {
        phoneNumber: true,
        name: true,
        email: true,
        address: true,
        addressNumber: true,
        addressComplement: true,
        zipCode: true,
        cpf: true,
        subscriptionPlan: true,
        waterReminderEnabled: true,
        waterReminderIntervalMinutes: true,
      },
    });
  }

  async changePasswordByCpf(cpf: string, dto: ChangePasswordDto) {
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const ok = await verifyPassword(dto.currentPassword, user.passwordHash, this.passwordPepper);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta');

    const newHash = await hashPassword(dto.newPassword, this.passwordPepper);
    await this.prisma.userProfile.update({
      where: { cpf },
      data: { passwordHash: newHash },
    });

    return { ok: true };
  }

  async deactivateMeByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF nao informado');

    const user = await this.prisma.userProfile.findUnique({
      where: { cpf },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) throw new NotFoundException('Usuario nao encontrado');

    // Log de auditoria - Desativação de conta
    this.logger.warn(`[AUDIT] Desativando conta: CPF=${cpf}, ID=${user.id}, Nome=${user.name}`);

    try {
      await this.prisma.userProfile.update({
        where: { cpf },
        data: { isActive: false },
      });

      // Log de auditoria - Conta desativada
      this.logger.warn(`[AUDIT] Conta DESATIVADA: CPF=${cpf}, ID=${user.id}, Timestamp=${new Date().toISOString()}`);

      return { ok: true, message: 'Conta desativada com sucesso. Você pode reativá-la fazendo login novamente.' };
    } catch (error: any) {
      this.logger.error(`[AUDIT] ERRO ao desativar conta: CPF=${cpf}, Error=${error?.message || 'Unknown'}`);
      throw new BadRequestException('Erro ao desativar conta');
    }
  }

  async deleteMeByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF nao informado');

    const user = await this.prisma.userProfile.findUnique({
      where: { cpf },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
      },
    });

    if (!user) throw new NotFoundException('Usuario nao encontrado');

    // Log de auditoria - Tentativa de deleção
    this.logger.warn(`[AUDIT] Tentativa de deletar conta: CPF=${cpf}, ID=${user.id}, Nome=${user.name}, Email=${user.email}`);

    try {
      // Deleta todos os registros relacionados ao usuário
      await this.prisma.$transaction([
        // Deleta os registros de uso de prompts
        this.prisma.promptUsage.deleteMany({
          where: { userId: user.id },
        }),
        // Deleta os pagamentos
        this.prisma.payment.deleteMany({
          where: { userId: user.id },
        }),
        // Por fim, deleta o usuário
        this.prisma.userProfile.delete({
          where: { cpf },
        }),
      ]);

      // Log de auditoria - Deleção bem-sucedida
      this.logger.warn(`[AUDIT] Conta DELETADA com sucesso: CPF=${cpf}, ID=${user.id}, Nome=${user.name}, Timestamp=${new Date().toISOString()}`);

      return { ok: true, message: 'Conta deletada com sucesso' };
    } catch (error: any) {
      // Log de auditoria - Erro ao deletar
      this.logger.error(`[AUDIT] ERRO ao deletar conta: CPF=${cpf}, ID=${user.id}, Error=${error?.message || 'Unknown'}`);

      if (error?.code === 'P2025') {
        throw new NotFoundException('Usuario nao encontrado');
      }
      throw new BadRequestException('Erro ao deletar conta');
    }
  }

  private async resolveTrialStatus(user: {
    phoneNumber: string;
    id: number;
    subscriptionPlan: SubscriptionPlan;
    isPaymentActive: boolean;
    lastPaymentAt: Date | null;
    subscriptionExpiresAt: Date | null;
  }) {
    const now = new Date();
    const payment = await this.prisma.payment.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    const hasPaidHistory = !!payment || !!user.lastPaymentAt;
    const hasPaidPlan =
      user.subscriptionPlan !== SubscriptionPlan.FREE ||
      user.isPaymentActive ||
      hasPaidHistory;
    const trialEndsAt = user.subscriptionExpiresAt ?? null;
    const trialActive = !hasPaidPlan && !!trialEndsAt && trialEndsAt > now;
    const trialExpired = !hasPaidPlan && !!trialEndsAt && trialEndsAt <= now;
    const trialEligible = !hasPaidPlan && !trialActive && !trialExpired;

    return {
      trialEligible,
      trialActive,
      trialExpired,
      trialEndsAt,
    };
  }
}
