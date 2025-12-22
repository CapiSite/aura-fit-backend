import { IsString, IsOptional, IsIn } from 'class-validator';
import { SubscriptionPlan, Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  phoneNumber: string;

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

  @IsOptional()
  @IsString()
  @IsIn(['USER', 'ADMIN'])
  role?: Role;
}
