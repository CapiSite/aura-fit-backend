import { IsEnum, IsOptional, IsString, ValidateIf, Matches, Length } from 'class-validator';
import { SubscriptionPlan } from '@prisma/client';
import { AsaasBillingType } from './create-plan-payment.dto';

export class CreateSubscriptionDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @IsEnum(AsaasBillingType)
  @IsOptional()
  paymentMethod?: AsaasBillingType;

  @IsEnum(AsaasBillingType)
  @IsOptional()
  billingType?: AsaasBillingType;

  @ValidateIf(
    (o) => (o.paymentMethod ?? o.billingType ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD,
  )
  @IsString()
  @Matches(/^[0-9]{13,19}$/, { message: 'Numero do cartao invalido' })
  creditCardNumber?: string;

  @ValidateIf(
    (o) => (o.paymentMethod ?? o.billingType ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD,
  )
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'Mes invalido (01-12)' })
  creditCardExpiryMonth?: string;

  @ValidateIf(
    (o) => (o.paymentMethod ?? o.billingType ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD,
  )
  @IsString()
  @Matches(/^[0-9]{2,4}$/, { message: 'Ano invalido' })
  creditCardExpiryYear?: string;

  @ValidateIf(
    (o) => (o.paymentMethod ?? o.billingType ?? AsaasBillingType.CREDIT_CARD) === AsaasBillingType.CREDIT_CARD,
  )
  @IsString()
  @Matches(/^[0-9]{3,4}$/, { message: 'CVV invalido' })
  creditCardCcv?: string;

  @IsString()
  @IsOptional()
  @Length(8, 8, { message: 'CEP deve ter 8 digitos' })
  @Matches(/^[0-9]{8}$/, { message: 'CEP invalido' })
  postalCode?: string;
}
