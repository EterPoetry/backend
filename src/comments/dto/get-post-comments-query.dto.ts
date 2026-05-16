import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const COMMENT_SORT_VALUES = ['newest', 'oldest', 'popular'] as const;
export type CommentSort = (typeof COMMENT_SORT_VALUES)[number];

export class GetPostCommentsQueryDto {
  @ApiPropertyOptional({
    example: '123',
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

  @ApiPropertyOptional({
    enum: COMMENT_SORT_VALUES,
    default: 'newest',
    description: 'Sort order for comments.',
  })
  @IsOptional()
  @IsString()
  @IsIn(COMMENT_SORT_VALUES)
  sort: CommentSort = 'newest';
}
