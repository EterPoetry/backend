import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SortOrder } from '../../posts/dto/get-my-posts-query.dto';

export enum AdminListSortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  EMAIL = 'email',
}

export class GetAdminsQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: AdminListSortBy, enumName: 'AdminListSortBy', default: AdminListSortBy.CREATED_AT })
  @IsOptional()
  @IsEnum(AdminListSortBy)
  sortBy: AdminListSortBy = AdminListSortBy.CREATED_AT;

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
