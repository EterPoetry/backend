import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class BrowserPushSubscriptionKeysDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth: string;
}

export class SaveBrowserPushSubscriptionDto {
  @ApiProperty()
  @IsUrl({
    require_protocol: true,
  })
  @MaxLength(1000)
  endpoint: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Browser-provided expiration time as a UNIX timestamp in milliseconds or null.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || typeof value === 'undefined' || value === '') {
      return null;
    }

    return new Date(typeof value === 'number' ? value : Number(value));
  })
  @IsDate()
  expirationTime?: Date | null;

  @ApiProperty({ type: BrowserPushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => BrowserPushSubscriptionKeysDto)
  keys: BrowserPushSubscriptionKeysDto;
}
