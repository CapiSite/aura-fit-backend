import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import { SubscriptionPlan, UserProfile } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      cpf: createUserDto.cpf,
      email: createUserDto.email ?? `${createUserDto.cpf}@aura.local`,
      subscriptionPlan: plan,
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
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
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
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
    if (!user) throw new NotFoundException('Usuario nao encontrado');

    const today = new Date();
    const usage = Array.from({ length: 7 }).map((_, idx) => {
      const date = new Date(today);
      date.setDate(today.getDate() - idx);
      // Usa requestsToday como base simples; em producao coletar logs reais
      const count = Math.max((user.requestsToday ?? 0) - idx, 0);
      return { date: date.toISOString().slice(0, 10), count };
    });

    return usage.reverse();
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
}
