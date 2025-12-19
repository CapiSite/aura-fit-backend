import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';

export enum PlanCode {
  PLUS = 'PLUS',
  PRO = 'PRO',
}

export enum AsaasBillingType {
  CREDIT_CARD = 'CREDIT_CARD',
  PIX = 'PIX',
}

export class CreatePlanPaymentDto {
  @IsEnum(PlanCode)
  plan: PlanCode;

  @IsEnum(AsaasBillingType)
  @IsOptional()
  paymentMethod?: AsaasBillingType;

  @ValidateIf((o) => (o.paymentMethod ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardNumber?: string;

  @ValidateIf((o) => (o.paymentMethod ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardExpiryMonth?: string;

  @ValidateIf((o) => (o.paymentMethod ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardExpiryYear?: string;

  @ValidateIf((o) => (o.paymentMethod ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardCcv?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;
}
