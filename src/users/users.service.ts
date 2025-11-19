import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma_connection/prisma.service';
import { UserProfile } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }

  async updateProfileFromIA(
    chatId: number,
    data: Partial<UserProfile>,
  ): Promise<UserProfile> {
    return this.prisma.userProfile.update({
      where: { chatId },
      data,
    });
  }

  async processMessageAndUpdateProfile(
    message: string,
    profile: UserProfile,
  ): Promise<UserProfile> {
    // TODO: Implementar a lógica de extração de informações da mensagem do usuário
    // para atualizar o perfil (ex: extrair peso, altura, etc. com IA ou regex)
    console.log('Processando mensagem no UsersService:', message);

    // Por enquanto, apenas retorna o perfil sem modificações
    return profile;
  }
}
