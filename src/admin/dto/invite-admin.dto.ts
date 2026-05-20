import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class InviteAdminDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email: string;
}
