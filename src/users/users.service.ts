import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import { UserProfile } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createUserDto: CreateUserDto) {
    const data = {
      chatId: String(createUserDto.chatId),
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
        throw new ConflictException('CPF ou chatId já cadastrado');
      }
      throw new BadRequestException('Erro ao criar usuário');
    }
  }

  findAll() {
    try {
      return this.prisma.userProfile.findMany();
    } catch {
      throw new BadRequestException('Erro ao listar usuários');
    }
  }

  async findOne(chatId: string) {
    try {
      const user = await this.prisma.userProfile.findUnique({ where: { chatId: String(chatId) } });
      if (!user) throw new NotFoundException('Usuário não encontrado');
      return user;
    } catch {
      throw new BadRequestException('Erro ao buscar usuário');
    }
  }

  async update(chatId: string, updateUserDto: UpdateUserDto) {
    const data: any = { ...updateUserDto };
    if (updateUserDto.chatId) data.chatId = String(updateUserDto.chatId);
    try {
      return await this.prisma.userProfile.update({ where: { chatId: String(chatId) }, data });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('CPF ou chatId já cadastrado');
      }
      if (error?.code === 'P2025') {
        throw new NotFoundException('Usuário não encontrado');
      }
      throw new BadRequestException('Erro ao atualizar usuário');
    }
  }

  async remove(chatId: string) {
    try {
      return await this.prisma.userProfile.delete({ where: { chatId: String(chatId) } });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new NotFoundException('Usuário não encontrado');
      }
      throw new BadRequestException('Erro ao remover usuário');
    }
  }

  async getStatsByCpf(cpf: string) {
    if (!cpf) throw new BadRequestException('CPF não informado');
    const user = await this.prisma.userProfile.findUnique({ where: { cpf } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
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

    console.log('Processando mensagem no UsersService:', message);
    return profile;
  }
}
