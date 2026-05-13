import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';

export class PostTextSynchronizationItemDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lineIndex: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  audioStartMomentMs: number;
}

export class UpdatePostTextSynchronizationDto {
  @ApiProperty({ type: [PostTextSynchronizationItemDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayUnique((item: PostTextSynchronizationItemDto) => item.lineIndex)
  @ValidateNested({ each: true })
  @Type(() => PostTextSynchronizationItemDto)
  textSynchronization: PostTextSynchronizationItemDto[];
}
