import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleCallbackDto {
  @ApiProperty({
    example: '4/0AfJohXkQ5HttFf1sUiYhPZ2Qz9Tg7',
  })
  @IsString()
  @MinLength(1)
  code: string;
}
