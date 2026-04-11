import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  text?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  originAuthorName?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  audioFileName?: string;

  @ApiPropertyOptional({ type: [Number], maxItems: 3 })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value.map((item) => Number(item));
    }

    return [Number(value)];
  })
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsInt({ each: true })
  categoryIds?: number[];
}
