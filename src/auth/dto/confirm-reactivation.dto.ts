import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmReactivationDto {
  @IsString()
  @IsNotEmpty({ message: 'Token e obrigatorio' })
  token: string;
}
