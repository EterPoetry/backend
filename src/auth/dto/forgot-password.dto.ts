import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'yehor@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  email: string;
}
