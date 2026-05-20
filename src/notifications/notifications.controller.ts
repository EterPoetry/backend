import {
  Controller,
  Get,
  Patch,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationType } from './notification-type.enum';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import {
  NotificationActorResponse,
  NotificationResponse,
  NotificationsService,
  PaginatedNotificationsResponse,
} from './notifications.service';

interface RequestWithUser extends Request {
  user: { userId: number; email?: string };
}

class NotificationActorResponseDto implements NotificationActorResponse {
  @ApiProperty()
  userId: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  username: string;

  @ApiPropertyOptional({ nullable: true })
  photo: string | null;

  @ApiProperty()
  isPremium: boolean;
}

class NotificationResponseDto implements NotificationResponse {
  @ApiProperty()
  notificationId: number;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  notificationType: NotificationType;

  @ApiProperty()
  eventsCount: number;

  @ApiProperty()
  isRead: boolean;

  @ApiPropertyOptional({ nullable: true })
  postId: number | null;

  @ApiPropertyOptional({ nullable: true })
  commentId: number | null;

  @ApiPropertyOptional({ nullable: true })
  postComplaintId: number | null;

  @ApiProperty()
  bucketStart: Date;

  @ApiProperty()
  bucketSizeMinutes: number;

  @ApiProperty()
  lastEventAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  readAt: Date | null;

  @ApiPropertyOptional({ type: () => NotificationActorResponseDto, nullable: true })
  lastActor: NotificationActorResponseDto | null;
}

class PaginatedNotificationsResponseDto implements PaginatedNotificationsResponse {
  @ApiProperty({ type: () => NotificationResponseDto, isArray: true })
  items: NotificationResponseDto[];

  @ApiProperty()
  limit: number;

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;

  @ApiProperty()
  unreadCount: number;
}

class OkResponseDto {
  @ApiProperty()
  ok: true;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getNotifications(
    @Req() req: RequestWithUser,
    @Query() query: GetNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    return this.notificationsService.getNotifications(req.user.userId, query);
  }

  @Patch(':notificationId/read')
  markNotificationAsRead(
    @Req() req: RequestWithUser,
    @Param('notificationId', ParseIntPipe) notificationId: number,
  ): Promise<OkResponseDto> {
    return this.notificationsService.markNotificationAsRead(req.user.userId, notificationId);
  }

  @Patch('read-all')
  markAllNotificationsAsRead(@Req() req: RequestWithUser): Promise<OkResponseDto> {
    return this.notificationsService.markAllNotificationsAsRead(req.user.userId);
  }
}
