import { IsEnum, IsOptional, IsString, ValidateIf, Matches, Length } from 'class-validator';
import { SubscriptionPlan } from '@prisma/client';
import { AsaasBillingType } from './create-plan-payment.dto';

export class ChangePlanDto {
  @IsEnum(SubscriptionPlan, { message: 'Plano inválido' })
  targetPlan: SubscriptionPlan;

  @IsEnum(AsaasBillingType)
  @IsOptional()
  paymentMethod?: AsaasBillingType;

  @ValidateIf((o) => o.paymentMethod === AsaasBillingType.CREDIT_CARD)
  @IsString()
  @Matches(/^[0-9]{13,19}$/, { message: 'Número do cartão inválido' })
  creditCardNumber?: string;

  @ValidateIf((o) => o.paymentMethod === AsaasBillingType.CREDIT_CARD)
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'Mês inválido (01-12)' })
  creditCardExpiryMonth?: string;

  @ValidateIf((o) => o.paymentMethod === AsaasBillingType.CREDIT_CARD)
  @IsString()
  @Matches(/^[0-9]{2,4}$/, { message: 'Ano inválido' })
  creditCardExpiryYear?: string;

  @ValidateIf((o) => o.paymentMethod === AsaasBillingType.CREDIT_CARD)
  @IsString()
  @Matches(/^[0-9]{3,4}$/, { message: 'CVV inválido' })
  creditCardCcv?: string;

  @IsString()
  @IsOptional()
  @Length(8, 8, { message: 'CEP deve ter 8 dígitos' })
  @Matches(/^[0-9]{8}$/, { message: 'CEP inválido' })
  postalCode?: string;
}
