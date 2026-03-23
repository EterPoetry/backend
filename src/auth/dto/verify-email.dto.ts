import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: 'yehor@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    example: 'f11d9f6c246b4e9a7aa9b3c8d3020e9b',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(32)
  code: string;
}
