import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class StartPostListenDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  sessionId: string;
}
