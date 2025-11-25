import { IsOptional, IsObject, IsString } from 'class-validator';

export class WebhookEventDto {
  @IsOptional()
  @IsString()
  instanceId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsObject()
  message?: Record<string, any>;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsObject()
  body?: Record<string, any>;

  [key: string]: any;
}
