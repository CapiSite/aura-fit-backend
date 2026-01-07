import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AsaasService } from './asaas.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreatePlanPaymentDto, AsaasBillingType } from './dto/create-plan-payment.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma_connection/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import type { AsaasPayment, AsaasWebhookPayload } from './entities/asaas.types';
import { SubscriptionPlan } from '@prisma/client';

type AuthRequest = Request & { user?: { cpf?: string; role?: string } };

@Controller('asaas')
export class AsaasController {
  constructor(
    private readonly asaasService: AsaasService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) { }

  @Post('customers')
  @UseGuards(AuthGuard)
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.asaasService.createCustomer(dto);
  }

  @Post('payments/plan')
  @UseGuards(AuthGuard)
  async createPlanPayment(@Req() req: AuthRequest, @Body() dto: CreatePlanPaymentDto) {
    const cpf = req?.user?.cpf;
    if (!cpf) {
      throw new HttpException('CPF nao informado', HttpStatus.BAD_REQUEST);
    }
    const user = await this.usersService.getMeByCpf(cpf);

    const customer = await this.asaasService.ensureCustomerFromProfile({
      name: user.name,
      cpfCnpj: user.cpf ?? '',
      email: user.email ?? undefined,
    });

    const paymentMethod = dto.paymentMethod ?? AsaasBillingType.CREDIT_CARD;
    const digits = (value: string | undefined) => (value ? value.replace(/\D/g, '') : '');
    const month = digits(dto.creditCardExpiryMonth).padStart(2, '0').slice(0, 2);
    const yearRaw = digits(dto.creditCardExpiryYear).slice(-2);
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

    return this.asaasService.createPlanPayment(dto.plan, customer.id, {
      dueDate: dto.dueDate,
      paymentMethod,
      chatId: user.phoneNumber,
      creditCard:
        paymentMethod === AsaasBillingType.PIX
          ? undefined
          : {
            holderName: user.name,
            number: digits(dto.creditCardNumber),
            expiryMonth: month,
            expiryYear: year,
            ccv: digits(dto.creditCardCcv),
          },
      holderInfo:
        paymentMethod === AsaasBillingType.PIX
          ? undefined
          : {
            name: user.name,
            email: user.email ?? undefined,
            cpfCnpj: user.cpf ?? '',
            postalCode: digits(dto.postalCode),
          },
    });
  }

  @Get('payments/:id')
  @UseGuards(AuthGuard)
  getPayment(@Param('id') id: string) {
    return this.asaasService.getPayment(id);
  }

  @Get('payments/:id/check')
  @UseGuards(AuthGuard)
  async checkPayment(@Req() req: AuthRequest, @Param('id') id: string) {
    const cpf = req?.user?.cpf;
    if (!cpf) {
      throw new HttpException('CPF nao informado', HttpStatus.BAD_REQUEST);
    }
    const user = await this.usersService.getMeByCpf(cpf);
    return this.asaasService.checkPaymentStatus(id, user.phoneNumber);
  }

  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 req/min para mudanças de plano
  @UseGuards(AuthGuard, ThrottlerGuard)
  @Post('payments/change-plan')
  async changePlan(@Req() req: AuthRequest, @Body() dto: ChangePlanDto) {
    const cpf = req?.user?.cpf;
    if (!cpf) {
      throw new HttpException('CPF não informado', HttpStatus.BAD_REQUEST);
    }
    const user = await this.usersService.getMeByCpf(cpf);

    const customer = await this.asaasService.ensureCustomerFromProfile({
      name: user.name,
      cpfCnpj: user.cpf ?? '',
      email: user.email ?? undefined,
    });

    const paymentMethod = dto.paymentMethod ?? AsaasBillingType.CREDIT_CARD;
    const digits = (value: string | undefined) => (value ? value.replace(/\\D/g, '') : '');
    const month = digits(dto.creditCardExpiryMonth).padStart(2, '0').slice(0, 2);
    const yearRaw = digits(dto.creditCardExpiryYear).slice(-2);
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

    return this.asaasService.createPlanChangePayment(user.id, dto.targetPlan, customer.id, {
      paymentMethod,
      chatId: user.phoneNumber,
      creditCard:
        paymentMethod === AsaasBillingType.PIX
          ? undefined
          : {
            holderName: user.name,
            number: digits(dto.creditCardNumber),
            expiryMonth: month,
            expiryYear: year,
            ccv: digits(dto.creditCardCcv),
          },
      holderInfo:
        paymentMethod === AsaasBillingType.PIX
          ? undefined
          : {
            name: user.name,
            email: user.email ?? undefined,
            cpfCnpj: user.cpf ?? '',
            postalCode: digits(dto.postalCode),
          },
    });
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 req/min para preview
  @UseGuards(AuthGuard, ThrottlerGuard)
  @Get('payments/change-plan/preview/:targetPlan')
  async getChangePlanPreview(@Req() req: AuthRequest, @Param('targetPlan') targetPlan: string) {
    const cpf = req?.user?.cpf;
    if (!cpf) {
      throw new HttpException('CPF não informado', HttpStatus.BAD_REQUEST);
    }

    // SECURITY: Validar targetPlan antes de processar
    const validPlans = Object.values(SubscriptionPlan);
    if (!validPlans.includes(targetPlan as SubscriptionPlan)) {
      throw new HttpException('Plano inválido', HttpStatus.BAD_REQUEST);
    }

    // SECURITY: Bloquear plano FREE
    if (targetPlan === 'FREE' || targetPlan === SubscriptionPlan.FREE) {
      throw new HttpException('Não é possível fazer downgrade para FREE', HttpStatus.FORBIDDEN);
    }

    const user = await this.usersService.getMeByCpf(cpf);

    const userProfile = await this.prisma.userProfile.findUnique({
      where: { id: user.id },
      select: {
        subscriptionPlan: true,
        subscriptionExpiresAt: true,
        isPaymentActive: true,
      },
    });

    if (!userProfile || !userProfile.subscriptionExpiresAt) {
      throw new HttpException('Nenhuma assinatura ativa', HttpStatus.BAD_REQUEST);
    }

    return this.asaasService.getPlanChangePreview(
      userProfile.subscriptionPlan,
      targetPlan as SubscriptionPlan,
      userProfile.subscriptionExpiresAt,
    );
  }

  @Post('webhook')
  async webhook(
    @Body() body: AsaasWebhookPayload | AsaasPayment,
    @Headers() headers: Record<string, string | string[]>,
  ) {
    const token =
      (headers?.['asaas-webhook-token'] as string | undefined) ??
      (headers?.['x-webhook-token'] as string | undefined);
    return this.asaasService.handleWebhook(body, token);
  }
}
