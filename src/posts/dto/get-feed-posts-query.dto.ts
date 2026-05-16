import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetFeedPostsQueryDto {
  @ApiPropertyOptional({
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTEzVDEyOjAwOjAwLjAwMFoiLCJwb3N0SWQiOjQyfQ==',
    description: 'Cursor for keyset pagination.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
