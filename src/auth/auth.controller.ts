import { Controller, Post, Body, BadRequestException } from '@nestjs/common'
import { AuthService } from './auth.service'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: any) {
    const { email, password, name, cpf, phone, subscriptionPlan } = body ?? {}
    if (!email || !password) throw new BadRequestException('E-mail e senha sao obrigatorios')
    return this.authService.register(email, password, name, cpf, phone, subscriptionPlan)
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const { email, password } = body ?? {}
    if (!email || !password) throw new BadRequestException('E-mail e senha sao obrigatorios')
    return this.authService.login(email, password)
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    const { email } = body ?? {}
    if (!email) throw new BadRequestException('E-mail e obrigatorio')
    return this.authService.forgotPassword(email)
  }
}
