import { IsString } from 'class-validator';
import { IsIn } from 'class-validator';
import { SubscriptionPlan } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  chatId: string;

  @IsString()
  name: string;

  @IsString()
  cpf: string;

  @IsString()
  @IsIn(['FREE', 'PLUS', 'PRO'])
  subscriptionPlan: SubscriptionPlan;
}
