import { Controller, Post, Body, BadRequestException } from '@nestjs/common'
import { AuthService } from './auth.service'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: { email: string; password: string }) {
    const { email, password } = body ?? {}
    if (!email || !password) throw new BadRequestException('E-mail e senha são obrigatórios')
    return this.authService.register(email, password)
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const { email, password } = body ?? {}
    if (!email || !password) throw new BadRequestException('E-mail e senha são obrigatórios')
    return this.authService.login(email, password)
  }
}
