import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateAdminProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ minLength: 8, maxLength: 128 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword?: string;

  @ApiPropertyOptional({ minLength: 8, maxLength: 128 })
  @ValidateIf((value: UpdateAdminProfileDto) => value.newPassword !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword?: string;
}
