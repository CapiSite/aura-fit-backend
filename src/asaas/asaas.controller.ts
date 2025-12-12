import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AsaasService } from './asaas.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreatePlanPaymentDto, PlanCode, AsaasBillingType } from './dto/create-plan-payment.dto';
import { UsersService } from 'src/users/users.service';
import { AuthGuard } from 'src/common/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('asaas')
export class AsaasController {
  constructor(private readonly asaasService: AsaasService, private readonly usersService: UsersService) {}

  @Post('customers')
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.asaasService.createCustomer(dto);
  }

  @Post('payments/plan')
  async createPlanPayment(@Req() req: any, @Body() dto: CreatePlanPaymentDto) {
    const cpf = req?.user?.cpf;
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

    return this.asaasService.createPlanPayment(dto.plan as PlanCode, customer.id, {
      externalReference: dto.externalReference ?? `${dto.plan}:${user.chatId}`,
      dueDate: dto.dueDate,
      paymentMethod,
      creditCard:
        paymentMethod === AsaasBillingType.PIX
          ? undefined
          : {
              holderName: dto.creditCardHolderName ?? user.name,
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
  getPayment(@Param('id') id: string) {
    return this.asaasService.getPayment(id);
  }

  @Post('webhook')
  async webhook(@Body() body: any, @Headers('x-webhook-token') token?: string) {
    return this.asaasService.handleWebhook(body, token);
  }
}
