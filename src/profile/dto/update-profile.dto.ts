import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsSafePublicHttpsUrl } from '../../common/validators/is-safe-public-https-url.validator';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '../../users/username.constants';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Yehor',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: 'yehor_poet',
    minLength: USERNAME_MIN_LENGTH,
    maxLength: USERNAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  username?: string;

  @ApiPropertyOptional({
    example: 'Poet, reader, and voice artist.',
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  bio?: string | null;

  @ApiPropertyOptional({
    example: 'https://example.com',
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsSafePublicHttpsUrl()
  link?: string | null;
}
