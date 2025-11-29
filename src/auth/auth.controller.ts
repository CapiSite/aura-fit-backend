import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: { cpf: string; password: string }) {
    const { cpf, password } = body ?? {};
    if (!cpf || !password) throw new BadRequestException('CPF e senha são obrigatórios');
    return this.authService.register(cpf, password);
  }

  @Post('login')
  async login(@Body() body: { cpf: string; password: string }) {
    const { cpf, password } = body ?? {};
    if (!cpf || !password) throw new BadRequestException('CPF e senha são obrigatórios');
    return this.authService.login(cpf, password);
  }
}
