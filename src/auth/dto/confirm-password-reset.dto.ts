import { IsString, IsNotEmpty, MinLength, Matches } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsString()
  @IsNotEmpty({ message: 'Token e obrigatorio' })
  token: string;

  @IsString()
  @IsNotEmpty({ message: 'Nova senha e obrigatoria' })
  @MinLength(8, { message: 'Senha deve ter no minimo 8 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Senha deve conter letras maiusculas, minusculas e numeros',
  })
  newPassword: string;
}
