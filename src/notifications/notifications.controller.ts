import {
  Body,
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
  ApiBody,
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { ComplaintReason } from '../common/enums/complaint-reason.enum';
import { Request } from 'express';
import { SaveBrowserPushSubscriptionDto } from './dto/save-browser-push-subscription.dto';
import { UpdatePushSettingsDto } from './dto/update-push-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationType } from './notification-type.enum';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import {
  BrowserPushNotificationsService,
  PushSettingsResponse,
  UpdatePushSettingsResponse,
} from './browser-push-notifications.service';
import {
  NotificationActorResponse,
  NotificationResponse,
  NotificationTargetType,
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

  @ApiProperty()
  isSeen: boolean;

  @ApiPropertyOptional({ nullable: true })
  postId: number | null;

  @ApiPropertyOptional({ nullable: true })
  postSlug: string | null;

  @ApiPropertyOptional({ nullable: true })
  postTitle: string | null;

  @ApiPropertyOptional({ nullable: true })
  commentId: number | null;

  @ApiPropertyOptional({ nullable: true })
  postComplaintId: number | null;

  @ApiPropertyOptional({ nullable: true })
  previewText: string | null;

  @ApiPropertyOptional({ nullable: true })
  commentPreviewText: string | null;

  @ApiPropertyOptional({ nullable: true })
  replyPreviewText: string | null;

  @ApiProperty({ enum: ['post', 'comment', 'profile', 'system'] })
  targetType: NotificationTargetType;

  @ApiProperty()
  targetLabel: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: false,
    properties: {
      postId: { type: 'number', nullable: true },
      postSlug: { type: 'string', nullable: true },
      commentId: { type: 'number', nullable: true },
      postComplaintId: { type: 'number', nullable: true },
      username: { type: 'string', nullable: true },
    },
  })
  targetRoutePayload: NotificationResponse['targetRoutePayload'];

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

  @ApiPropertyOptional({ nullable: true })
  seenAt: Date | null;

  @ApiPropertyOptional({ type: () => NotificationActorResponseDto, nullable: true })
  lastActor: NotificationActorResponseDto | null;

  @ApiPropertyOptional({ enum: ComplaintReason, enumName: 'ComplaintReason', nullable: true })
  violationReason?: ComplaintReason | null;
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

  @ApiProperty()
  unseenCount: number;
}

class OkResponseDto {
  @ApiProperty()
  ok: true;
}

class SeenResponseDto extends OkResponseDto {
  @ApiProperty()
  unseenCount: number;
}

class PushSettingsResponseDto implements PushSettingsResponse {
  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType', isArray: true })
  disabledTypes: NotificationType[];
}

class UpdatePushSettingsResponseDto extends OkResponseDto implements UpdatePushSettingsResponse {
  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType', isArray: true })
  disabledTypes: NotificationType[];
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly browserPushNotificationsService: BrowserPushNotificationsService,
  ) {}

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

  @Patch('seen')
  markAllNotificationsAsSeen(@Req() req: RequestWithUser): Promise<SeenResponseDto> {
    return this.notificationsService.markAllNotificationsAsSeen(req.user.userId);
  }

  @Patch(':notificationId/seen')
  markNotificationAsSeen(
    @Req() req: RequestWithUser,
    @Param('notificationId', ParseIntPipe) notificationId: number,
  ): Promise<SeenResponseDto> {
    return this.notificationsService.markNotificationAsSeen(req.user.userId, notificationId);
  }

  @ApiBody({ type: SaveBrowserPushSubscriptionDto })
  @Patch('browser-push/subscriptions')
  saveBrowserPushSubscription(
    @Req() req: RequestWithUser,
    @Body() dto: SaveBrowserPushSubscriptionDto,
  ): Promise<OkResponseDto> {
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader : null;

    return this.browserPushNotificationsService.saveSubscription(req.user.userId, dto, userAgent);
  }

  @ApiBody({ type: SaveBrowserPushSubscriptionDto })
  @Patch('browser-push/subscriptions/delete')
  deleteBrowserPushSubscription(
    @Req() req: RequestWithUser,
    @Body() dto: SaveBrowserPushSubscriptionDto,
  ): Promise<OkResponseDto> {
    return this.browserPushNotificationsService.deleteSubscription(req.user.userId, dto.endpoint);
  }

  @Get('push/settings')
  getPushSettings(
    @Req() req: RequestWithUser,
  ): Promise<PushSettingsResponseDto> {
    return this.browserPushNotificationsService.getSettings(req.user.userId);
  }

  @ApiBody({ type: UpdatePushSettingsDto })
  @Patch('push/settings')
  updatePushSettings(
    @Req() req: RequestWithUser,
    @Body() dto: UpdatePushSettingsDto,
  ): Promise<UpdatePushSettingsResponseDto> {
    return this.browserPushNotificationsService.updateSettings(req.user.userId, dto);
  }
}
