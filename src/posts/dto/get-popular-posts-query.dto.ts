import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetPopularPostsQueryDto {
  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    example: 42,
    description: 'Pinned popular feed snapshot identifier. Omit on initial load or refresh.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  snapshotId?: number;

  @ApiPropertyOptional({
    example: 'eyJsYXN0UmFuayI6MjB9',
    description: 'Opaque pagination cursor returned by the previous response.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
