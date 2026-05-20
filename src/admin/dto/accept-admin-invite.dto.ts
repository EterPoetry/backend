import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptAdminInviteDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
