import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ComplaintStatus } from '../../common/enums/complaint-status.enum';
import { SortOrder } from '../../posts/dto/get-my-posts-query.dto';

export enum AdminComplaintListSortBy {
  CREATED_AT = 'createdAt',
  STATUS = 'status',
  REASON = 'reason',
}

export class GetAdminComplaintsQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: ComplaintStatus, enumName: 'ComplaintStatus' })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({
    enum: AdminComplaintListSortBy,
    enumName: 'AdminComplaintListSortBy',
    default: AdminComplaintListSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(AdminComplaintListSortBy)
  sortBy: AdminComplaintListSortBy = AdminComplaintListSortBy.CREATED_AT;

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
