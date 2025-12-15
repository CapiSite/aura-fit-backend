import { IsString, IsOptional, IsIn } from 'class-validator';
import { SubscriptionPlan } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  chatId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsString()
  email?: string;

  @IsString()
  @IsIn(['FREE', 'PLUS', 'PRO'])
  subscriptionPlan: SubscriptionPlan;
}
