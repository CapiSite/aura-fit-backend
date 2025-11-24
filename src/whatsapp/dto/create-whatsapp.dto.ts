import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateWhatsappDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\d{10,}|.+@g\.us)$/)
  phone: string;

  @IsString()
  message: string;
}
