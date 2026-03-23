import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'f11d9f6c246b4e9a7aa9b3c8d3020e9b7d3f0e7b1c65d5bfb1c69e0b1f8c2a0f',
  })
  @IsString()
  @MinLength(10)
  token: string;

  @ApiProperty({
    example: 'newSecret123',
    minLength: 6,
    maxLength: 255,
  })
  @IsString()
  @MinLength(6)
  @MaxLength(255)
  newPassword: string;
}
