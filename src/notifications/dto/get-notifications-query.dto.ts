import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const NOTIFICATION_STATUS_FILTERS = ['all', 'unread'] as const;
export type NotificationStatusFilter = (typeof NOTIFICATION_STATUS_FILTERS)[number];

export const NOTIFICATION_TYPE_FILTERS = [
  'comments',
  'follows',
  'mentions',
  'likes',
  'system',
] as const;
export type NotificationTypeFilter = (typeof NOTIFICATION_TYPE_FILTERS)[number];

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({
    example: 'eyJsYXN0RXZlbnRBdCI6IjIwMjYtMDUtMjBUMTE6MDA6MDAuMDAwWiIsIm5vdGlmaWNhdGlvbklkIjo0Mn0',
    description: 'Cursor for keyset pagination.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    enum: NOTIFICATION_STATUS_FILTERS,
    default: 'all',
    description: 'Filters notifications by read state.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUS_FILTERS)
  status: NotificationStatusFilter = 'all';

  @ApiPropertyOptional({
    enum: NOTIFICATION_TYPE_FILTERS,
    description: 'Filters notifications by frontend category.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPE_FILTERS)
  type?: NotificationTypeFilter;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
