
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsNumber, ValidateNested, IsObject } from 'class-validator';

export class MetaMessageText {
  @IsString()
  body: string;
}

export class MetaMessageImage {
  @IsString()
  id: string;

  @IsString()
  @IsOptional()
  mime_type?: string;

  @IsString()
  @IsOptional()
  sha256?: string;

  @IsString()
  @IsOptional()
  caption?: string;
}

export class MetaMessage {
  @IsString()
  from: string;

  @IsString()
  id: string;

  @IsString()
  @IsOptional()
  timestamp: string;

  @IsString()
  type: string;

  @ValidateNested()
  @Type(() => MetaMessageText)
  @IsOptional()
  text?: MetaMessageText;

  @ValidateNested()
  @Type(() => MetaMessageImage)
  @IsOptional()
  image?: MetaMessageImage;
}

export class MetaContactProfile {
  @IsString()
  @IsOptional()
  name?: string;
}

export class MetaContact {
  @IsString()
  wa_id: string;

  @ValidateNested()
  @Type(() => MetaContactProfile)
  @IsOptional()
  profile?: MetaContactProfile;
}

export class MetaMetadata {
  @IsString()
  display_phone_number: string;

  @IsString()
  phone_number_id: string;
}

export class MetaValue {
  @IsString()
  messaging_product: string;

  @ValidateNested()
  @Type(() => MetaMetadata)
  @IsOptional()
  metadata?: MetaMetadata;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetaContact)
  @IsOptional()
  contacts?: MetaContact[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetaMessage)
  @IsOptional()
  messages?: MetaMessage[];
}

export class MetaChange {
  @ValidateNested()
  @Type(() => MetaValue)
  value: MetaValue;

  @IsString()
  field: string;
}

export class MetaEntry {
  @IsString()
  id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetaChange)
  changes: MetaChange[];
}

export class WebhookEventDto {
  @IsString()
  object: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetaEntry)
  entry: MetaEntry[];
}
