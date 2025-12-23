import { IsEmail, IsNotEmpty } from 'class-validator';

export class RequestReactivationDto {
  @IsEmail({}, { message: 'Email invalido' })
  @IsNotEmpty({ message: 'Email e obrigatorio' })
  email: string;
}
