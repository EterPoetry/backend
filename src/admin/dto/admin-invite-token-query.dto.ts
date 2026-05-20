import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AdminInviteTokenQueryDto {
  @ApiProperty({
    description: 'Admin invitation token from the email link.',
    minLength: 64,
    maxLength: 64,
  })
  @IsString()
  @Length(64, 64)
  token: string;
}
