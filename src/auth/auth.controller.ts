import { Controller, Post, Body, BadRequestException, UsePipes, ValidationPipe } from '@nestjs/common'
import { AuthService } from './auth.service'
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { RequestReactivationDto } from './dto/request-reactivation.dto';
import { ConfirmReactivationDto } from './dto/confirm-reactivation.dto';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(private readonly authService: AuthService) { }

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

  @Post('request-reactivation')
  async requestReactivation(@Body() dto: RequestReactivationDto) {
    return this.authService.requestReactivation(dto.email)
  }

  @Post('confirm-reactivation')
  async confirmReactivation(@Body() dto: ConfirmReactivationDto) {
    return this.authService.confirmReactivation(dto.token)
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email)
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(dto.token, dto.newPassword)
  }
}
