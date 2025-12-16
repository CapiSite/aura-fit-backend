import { Injectable, ConflictException, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private get passwordPepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER') ?? 'dev-password-pepper';
  }

  async create(createUserDto: CreateUserDto) {
    const chatId = String(createUserDto.chatId);
    const plan = (createUserDto.subscriptionPlan ?? SubscriptionPlan.FREE) as SubscriptionPlan;

    const existing = await this.prisma.userProfile.findFirst({
      where: {
        OR: [{ cpf: createUserDto.cpf }, { chatId }],
      },
    });
    if (existing) {
      throw new ConflictException('CPF ou chatId ja cadastrado');
    }

    const data = {
      chatId,
      name: createUserDto.name,
      cpf: createUserDto.cpf ?? null,
      email: createUserDto.email ?? `${createUserDto.chatId}@aura.local`,
      subscriptionPlan: createUserDto.subscriptionPlan ?? 'FREE',
      requestsToday: 0,
      requestsLastReset: new Date(),
    };
    try {
      return await this.prisma.userProfile.create({ data });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('CPF ou chatId ja cadastrado');
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

  async findOne(chatId: string) {
    try {
      const user = await this.prisma.userProfile.findUnique({ where: { chatId: String(chatId) } });
      if (!user) throw new NotFoundException('Usuario nao encontrado');
      return user;
    } catch {
      throw new BadRequestException('Erro ao buscar usuario');
    }
  }

  async update(chatId: string, updateUserDto: UpdateUserDto) {
    const data: any = { ...updateUserDto };
    if (updateUserDto.chatId) data.chatId = String(updateUserDto.chatId);
    try {
      return await this.prisma.userProfile.update({ where: { chatId: String(chatId) }, data });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('CPF ou chatId ja cadastrado');
      }
      if (error?.code === 'P2025') {
        throw new NotFoundException('Usuario nao encontrado');
      }
      throw new BadRequestException('Erro ao atualizar usuario');
    }
  }

  async remove(chatId: string) {
    try {
      return await this.prisma.userProfile.delete({ where: { chatId: String(chatId) } });
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
    const limits: Record<string, number> = { FREE: 5, PLUS: 25, PRO: 40 };
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
      where: { chatId: user.chatId },
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
        chatId: true,
        name: true,
        cpf: true,
        email: true,
        subscriptionPlan: true,
        role: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario nao encontrado');
    return user;
  }

  async updateProfileFromIA(
    chatId: string | number,
    data: Partial<UserProfile>,
  ): Promise<UserProfile> {
    const id = String(chatId);
    return this.prisma.userProfile.update({
      where: { chatId: id },
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

    if (data.email) {
      const exists = await this.prisma.userProfile.findFirst({
        where: { email: data.email, NOT: { cpf } },
      });
      if (exists) throw new ConflictException('E-mail ja utilizado por outro usuario');
    }

    return this.prisma.userProfile.update({
      where: { cpf },
      data,
      select: { chatId: true, name: true, email: true, cpf: true, subscriptionPlan: true },
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
}
