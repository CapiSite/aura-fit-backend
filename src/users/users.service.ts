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
      cpf: createUserDto.cpf,
      email: createUserDto.email ?? `${createUserDto.cpf}@aura.local`,
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
    return {
      requestsToday: user.requestsToday ?? 0,
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
