import { IsString, Matches } from 'class-validator';

export class CreateWhatsappDto {
  @IsString()
  @Matches(/^(\d{10,}|.+@g\.us)$/)
  phone: string;

  @IsString()
  message: string;
}
