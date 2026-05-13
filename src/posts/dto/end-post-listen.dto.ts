import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class EndPostListenDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionMs: number;

  @ApiProperty({ maxLength: 120, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sessionId?: string;
}
