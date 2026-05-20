import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum AdminStatsInterval {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class GetAdminStatsQueryDto {
  @ApiPropertyOptional({ enum: AdminStatsInterval, enumName: 'AdminStatsInterval', default: AdminStatsInterval.DAILY })
  @IsOptional()
  @IsEnum(AdminStatsInterval)
  interval: AdminStatsInterval = AdminStatsInterval.DAILY;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
