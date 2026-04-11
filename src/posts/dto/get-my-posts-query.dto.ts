import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum MyPostsSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  TITLE = 'title',
  LISTENS = 'listens',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class GetMyPostsQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: MyPostsSortBy, enumName: 'MyPostsSortBy', default: MyPostsSortBy.CREATED_AT })
  @IsOptional()
  @IsEnum(MyPostsSortBy)
  sortBy: MyPostsSortBy = MyPostsSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, enumName: 'SortOrder', default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({ example: 0, default: 0, minimum: 0 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset: number = 0;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
