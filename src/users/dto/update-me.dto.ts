import { IsEmail, IsOptional, IsString, MaxLength, MinLength, IsBoolean, IsInt, Min } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  addressNumber?: string;

  @IsOptional()
  @IsString()
  addressComplement?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsBoolean()
  waterReminderEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  waterReminderIntervalMinutes?: number;
}
