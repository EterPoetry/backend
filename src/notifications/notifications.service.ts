import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PostComment } from '../comments/entities/post-comment.entity';
import { User } from '../users/entities/user.entity';
import {
  GetNotificationsQueryDto,
  NotificationStatusFilter,
  NotificationTypeFilter,
} from './dto/get-notifications-query.dto';
import { BrowserPushNotificationsService } from './browser-push-notifications.service';
import { NotificationEvent } from './entities/notification-event.entity';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './notification-type.enum';
import {ComplaintReason} from "../common/enums/complaint-reason.enum";

export type NotificationTargetType = 'post' | 'comment' | 'profile' | 'system';

export interface NotificationActorResponse {
  userId: number;
  name: string;
  username: string;
  photo: string | null;
  isPremium: boolean;
}

export interface NotificationResponse {
  notificationId: number;
  notificationType: NotificationType;
  eventsCount: number;
  isRead: boolean;
  isSeen: boolean;
  postId: number | null;
  postSlug: string | null;
  postTitle: string | null;
  commentId: number | null;
  postComplaintId: number | null;
  previewText: string | null;
  commentPreviewText: string | null;
  replyPreviewText: string | null;
  targetType: NotificationTargetType;
  targetLabel: string;
  targetRoutePayload: {
    postId: number | null;
    postSlug: string | null;
    commentId: number | null;
    postComplaintId: number | null;
    username: string | null;
  } | null;
  bucketStart: Date;
  bucketSizeMinutes: number;
  lastEventAt: Date;
  createdAt: Date;
  readAt: Date | null;
  seenAt: Date | null;
  lastActor: NotificationActorResponse | null;
  violationReason?: ComplaintReason | null;
}

export interface PaginatedNotificationsResponse {
  items: NotificationResponse[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
  unseenCount: number;
}

interface NotificationCursorPayload {
  lastEventAt: string;
  notificationId: number;
  status: NotificationStatusFilter;
  type: NotificationTypeFilter | null;
}

interface RecordNotificationInput {
  recipientUserId: number;
  notificationType: NotificationType;
  actorUserId?: number | null;
  postId?: number | null;
  commentId?: number | null;
  postComplaintId?: number | null;
  sourcePostReactionId?: number | null;
  sourceCommentReactionId?: number | null;
  sourceFollowerId?: number | null;
  sourcePostCommentId?: number | null;
  sourcePostComplaintId?: number | null;
  bucketSizeMinutes: number;
  groupByHour: boolean;
}

const NOTIFICATION_UNDO_WINDOW_MINUTES = 5;
const NOTIFICATION_PREVIEW_MAX_LENGTH = 160;
const NOTIFICATION_TYPE_GROUPS: Record<Exclude<NotificationTypeFilter, 'mentions'>, NotificationType[]> = {
  comments: [NotificationType.POST_COMMENTED, NotificationType.COMMENT_REPLIED],
  follows: [NotificationType.USER_FOLLOWED],
  likes: [NotificationType.POST_LIKED, NotificationType.COMMENT_LIKED],
  system: [NotificationType.POST_VIOLATION_CONFIRMED],
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(NotificationEvent)
    private readonly notificationEventsRepository: Repository<NotificationEvent>,
    private readonly browserPushNotificationsService: BrowserPushNotificationsService,
  ) {}

  async getNotifications(
    recipientUserId: number,
    query: GetNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponse> {
    const cursor = this.decodeCursor(query.cursor, query);
    const queryBuilder = this.notificationsRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect(
        'notification.lastActor',
        'lastActor',
        'lastActor.deleted_at IS NULL',
      )
      .leftJoinAndSelect('lastActor.subscription', 'lastActorSubscription')
      .leftJoinAndSelect('notification.post', 'post')
      .leftJoinAndSelect('notification.comment', 'comment')
      .leftJoinAndSelect('notification.postComplaint', 'postComplaint')
      .where('notification.recipient_user_id = :recipientUserId', { recipientUserId })
      .orderBy('notification.last_event_at', 'DESC')
      .addOrderBy('notification.notification_id', 'DESC');

    this.applyQueryFilters(queryBuilder, query);

    if (cursor) {
      queryBuilder.andWhere(
        '(notification.last_event_at < :lastEventAt OR (notification.last_event_at = :lastEventAt AND notification.notification_id < :notificationId))',
        {
          lastEventAt: cursor.lastEventAt,
          notificationId: cursor.notificationId,
        },
      );
    }

    const rows = await queryBuilder.limit(query.limit + 1).getMany();
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows.at(-1);
    const unreadCount = await this.notificationsRepository.countBy({
      recipientUserId,
      isRead: false,
    });
    const unseenCount = await this.notificationsRepository.countBy({
      recipientUserId,
      isSeen: false,
    });

    return {
      items: pageRows.map((notification) => this.mapNotification(notification)),
      limit: query.limit,
      nextCursor: hasMore && lastRow ? this.encodeCursor(lastRow, query) : null,
      hasMore,
      unreadCount,
      unseenCount,
    };
  }

  async markNotificationAsRead(
    recipientUserId: number,
    notificationId: number,
  ): Promise<{ ok: true }> {
    const result = await this.notificationsRepository
      .createQueryBuilder()
      .update(Notification)
      .set({
        isRead: true,
        isSeen: true,
        readAt: () => 'NOW()',
        seenAt: () => 'COALESCE("seen_at", NOW())',
      })
      .where('notification_id = :notificationId', { notificationId })
      .andWhere('recipient_user_id = :recipientUserId', { recipientUserId })
      .execute();

    if (!result.affected) {
      throw new NotFoundException('Notification not found.');
    }

    return { ok: true };
  }

  async markAllNotificationsAsRead(recipientUserId: number): Promise<{ ok: true }> {
    await this.notificationsRepository
      .createQueryBuilder()
      .update(Notification)
      .set({
        isRead: true,
        isSeen: true,
        readAt: () => 'NOW()',
        seenAt: () => 'COALESCE("seen_at", NOW())',
      })
      .where('recipient_user_id = :recipientUserId', { recipientUserId })
      .andWhere('(is_read = false OR is_seen = false)')
      .execute();

    return { ok: true };
  }

  async markNotificationAsSeen(
    recipientUserId: number,
    notificationId: number,
  ): Promise<{ ok: true; unseenCount: number }> {
    const result = await this.notificationsRepository
      .createQueryBuilder()
      .update(Notification)
      .set({
        isSeen: true,
        seenAt: () => 'COALESCE("seen_at", NOW())',
      })
      .where('notification_id = :notificationId', { notificationId })
      .andWhere('recipient_user_id = :recipientUserId', { recipientUserId })
      .execute();

    if (!result.affected) {
      throw new NotFoundException('Notification not found.');
    }

    return {
      ok: true,
      unseenCount: await this.getUnseenCount(recipientUserId),
    };
  }

  async markAllNotificationsAsSeen(
    recipientUserId: number,
  ): Promise<{ ok: true; unseenCount: number }> {
    await this.notificationsRepository
      .createQueryBuilder()
      .update(Notification)
      .set({
        isSeen: true,
        seenAt: () => 'COALESCE("seen_at", NOW())',
      })
      .where('recipient_user_id = :recipientUserId', { recipientUserId })
      .andWhere('is_seen = false')
      .execute();

    return {
      ok: true,
      unseenCount: 0,
    };
  }

  async recordPostLike(
    recipientUserId: number,
    actorUserId: number,
    postId: number,
    sourcePostReactionId: number,
  ): Promise<void> {
    await this.recordNotification({
      recipientUserId,
      actorUserId,
      notificationType: NotificationType.POST_LIKED,
      postId,
      sourcePostReactionId,
      bucketSizeMinutes: 60,
      groupByHour: true,
    });
  }

  async removePostLike(sourcePostReactionId: number): Promise<void> {
    await this.removeNotificationEventsWithinUndoWindow({
      sourcePostReactionId,
    });
  }

  async recordPostComment(
    recipientUserId: number,
    actorUserId: number,
    postId: number,
    sourcePostCommentId: number,
  ): Promise<void> {
    await this.recordNotification({
      recipientUserId,
      actorUserId,
      notificationType: NotificationType.POST_COMMENTED,
      postId,
      sourcePostCommentId,
      bucketSizeMinutes: 60,
      groupByHour: true,
    });
  }

  async recordCommentReply(
    recipientUserId: number,
    actorUserId: number,
    postId: number,
    commentId: number,
    sourcePostCommentId: number,
  ): Promise<void> {
    await this.recordNotification({
      recipientUserId,
      actorUserId,
      notificationType: NotificationType.COMMENT_REPLIED,
      postId,
      commentId,
      sourcePostCommentId,
      bucketSizeMinutes: 60,
      groupByHour: true,
    });
  }

  async removeNotificationsForComment(sourcePostCommentId: number): Promise<void> {
    await this.removeNotificationsForComments([sourcePostCommentId]);
  }

  async removeNotificationsForComments(sourcePostCommentIds: number[]): Promise<void> {
    if (!sourcePostCommentIds.length) {
      return;
    }

    await this.removeNotificationEvents({
      sourcePostCommentIds,
    });
  }

  async recordCommentLike(
    recipientUserId: number,
    actorUserId: number,
    postId: number,
    commentId: number,
    sourceCommentReactionId: number,
  ): Promise<void> {
    await this.recordNotification({
      recipientUserId,
      actorUserId,
      notificationType: NotificationType.COMMENT_LIKED,
      postId,
      commentId,
      sourceCommentReactionId,
      bucketSizeMinutes: 60,
      groupByHour: true,
    });
  }

  async removeCommentLike(sourceCommentReactionId: number): Promise<void> {
    await this.removeNotificationEventsWithinUndoWindow({
      sourceCommentReactionId,
    });
  }

  async recordFollow(
    recipientUserId: number,
    actorUserId: number,
    sourceFollowerId: number,
  ): Promise<void> {
    await this.recordNotification({
      recipientUserId,
      actorUserId,
      notificationType: NotificationType.USER_FOLLOWED,
      sourceFollowerId,
      bucketSizeMinutes: 60,
      groupByHour: true,
    });
  }

  async removeFollow(sourceFollowerId: number): Promise<void> {
    await this.removeNotificationEventsWithinUndoWindow({
      sourceFollowerId,
    });
  }

  async recordPostViolationConfirmed(
    recipientUserId: number,
    postId: number,
    postComplaintId: number,
  ): Promise<void> {
    await this.recordNotification({
      recipientUserId,
      notificationType: NotificationType.POST_VIOLATION_CONFIRMED,
      postId,
      postComplaintId,
      sourcePostComplaintId: postComplaintId,
      bucketSizeMinutes: 0,
      groupByHour: false,
    });
  }

  private async recordNotification(input: RecordNotificationInput): Promise<void> {
    if (input.actorUserId !== undefined && input.actorUserId !== null) {
      if (input.actorUserId === input.recipientUserId) {
        return;
      }
    }

    const now = new Date();
    const bucketStart = input.groupByHour ? this.getHourBucketStart(now) : now;
    const groupKey = this.buildGroupKey(input, bucketStart, now);

    await this.dataSource.transaction(async (manager) => {
      const previewText = await this.resolvePreviewText(manager, input);
      const insertResult = await manager
        .createQueryBuilder()
        .insert()
        .into(NotificationEvent)
        .values({
          recipientUserId: input.recipientUserId,
          actorUserId: input.actorUserId ?? null,
          postId: input.postId ?? null,
          commentId: input.commentId ?? null,
          postComplaintId: input.postComplaintId ?? null,
          sourcePostReactionId: input.sourcePostReactionId ?? null,
          sourceCommentReactionId: input.sourceCommentReactionId ?? null,
          sourceFollowerId: input.sourceFollowerId ?? null,
          sourcePostCommentId: input.sourcePostCommentId ?? null,
          sourcePostComplaintId: input.sourcePostComplaintId ?? null,
          notificationType: input.notificationType,
          groupKey,
          createdAt: now,
        })
        .orIgnore()
        .returning(['notification_event_id'])
        .execute();

      if (!insertResult.raw.length) {
        return;
      }

      await manager.query(
        `
          INSERT INTO "notifications" (
            "recipient_user_id",
            "last_actor_user_id",
            "post_id",
            "comment_id",
            "post_complaint_id",
            "notification_type",
            "group_key",
            "events_count",
            "is_read",
            "is_seen",
            "bucket_start",
            "bucket_size_minutes",
            "last_event_at",
            "created_at",
            "read_at",
            "seen_at",
            "preview_text"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 1, false, false, $8, $9, $10, $10, NULL, NULL, $11)
          ON CONFLICT ("group_key")
          DO UPDATE SET
            "last_actor_user_id" = COALESCE(EXCLUDED."last_actor_user_id", "notifications"."last_actor_user_id"),
            "events_count" = "notifications"."events_count" + 1,
            "is_read" = false,
            "is_seen" = false,
            "last_event_at" = EXCLUDED."last_event_at",
            "read_at" = NULL,
            "seen_at" = NULL,
            "preview_text" = COALESCE(EXCLUDED."preview_text", "notifications"."preview_text")
        `,
        [
          input.recipientUserId,
          input.actorUserId ?? null,
          input.postId ?? null,
          input.commentId ?? null,
          input.postComplaintId ?? null,
          input.notificationType,
          groupKey,
          bucketStart,
          input.bucketSizeMinutes,
          now,
          previewText,
        ],
      );
    });

    void this.sendBrowserPushForGroupKey(input.recipientUserId, groupKey);
  }

  private async removeNotificationEvents(filters: {
    sourcePostReactionId?: number;
    sourceCommentReactionId?: number;
    sourceFollowerId?: number;
    sourcePostCommentId?: number;
    sourcePostCommentIds?: number[];
    createdAfter?: Date;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const queryBuilder = manager
        .createQueryBuilder()
        .delete()
        .from(NotificationEvent)
        .returning(['group_key'])
        .where('1 = 1');

      if (filters.sourcePostReactionId !== undefined) {
        queryBuilder.andWhere('source_post_reaction_id = :sourcePostReactionId', {
          sourcePostReactionId: filters.sourcePostReactionId,
        });
      }

      if (filters.sourceCommentReactionId !== undefined) {
        queryBuilder.andWhere('source_comment_reaction_id = :sourceCommentReactionId', {
          sourceCommentReactionId: filters.sourceCommentReactionId,
        });
      }

      if (filters.sourceFollowerId !== undefined) {
        queryBuilder.andWhere('source_follower_id = :sourceFollowerId', {
          sourceFollowerId: filters.sourceFollowerId,
        });
      }

      if (filters.sourcePostCommentId !== undefined) {
        queryBuilder.andWhere('source_post_comment_id = :sourcePostCommentId', {
          sourcePostCommentId: filters.sourcePostCommentId,
        });
      }

      if (filters.sourcePostCommentIds !== undefined) {
        queryBuilder.andWhere('source_post_comment_id IN (:...sourcePostCommentIds)', {
          sourcePostCommentIds: filters.sourcePostCommentIds,
        });
      }

      if (filters.createdAfter !== undefined) {
        queryBuilder.andWhere('created_at >= :createdAfter', {
          createdAfter: filters.createdAfter,
        });
      }

      const deleteResult = await queryBuilder.execute();
      const groupKeys = [
        ...new Set(
          (deleteResult.raw as Array<{ group_key?: string }>)
            .map((row) => row.group_key)
            .filter((groupKey): groupKey is string => Boolean(groupKey)),
        ),
      ];

      for (const groupKey of groupKeys) {
        await this.syncNotificationGroup(manager, groupKey);
      }
    });
  }

  private async removeNotificationEventsWithinUndoWindow(filters: {
    sourcePostReactionId?: number;
    sourceCommentReactionId?: number;
    sourceFollowerId?: number;
  }): Promise<void> {
    await this.removeNotificationEvents({
      ...filters,
      createdAfter: new Date(
        Date.now() - NOTIFICATION_UNDO_WINDOW_MINUTES * 60 * 1000,
      ),
    });
  }

  private async syncNotificationGroup(manager: EntityManager, groupKey: string): Promise<void> {
    const eventCount = await manager.getRepository(NotificationEvent).count({
      where: { groupKey },
    });

    if (eventCount === 0) {
      await manager.getRepository(Notification).delete({ groupKey });
      return;
    }

    const latestEvent = await manager.getRepository(NotificationEvent).findOne({
      where: { groupKey },
      order: {
        createdAt: 'DESC',
        notificationEventId: 'DESC',
      },
    });

    if (!latestEvent) {
      await manager.getRepository(Notification).delete({ groupKey });
      return;
    }

    await manager.getRepository(Notification).update(
      { groupKey },
      {
        eventsCount: eventCount,
        lastActorUserId: latestEvent.actorUserId,
        lastEventAt: latestEvent.createdAt,
        previewText: await this.resolvePreviewTextFromEvent(manager, latestEvent),
      },
    );
  }

  private buildGroupKey(
    input: RecordNotificationInput,
    bucketStart: Date,
    now: Date,
  ): string {
    const stableTimestamp = input.groupByHour ? bucketStart.toISOString() : now.toISOString();
    return [
      input.notificationType,
      input.recipientUserId,
      input.postId ?? 0,
      input.commentId ?? 0,
      input.postComplaintId ?? 0,
      stableTimestamp,
    ].join(':');
  }

  private getHourBucketStart(date: Date): Date {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        0,
        0,
        0,
      ),
    );
  }

  private encodeCursor(notification: Notification, query: GetNotificationsQueryDto): string {
    return Buffer.from(
      JSON.stringify({
        lastEventAt: notification.lastEventAt.toISOString(),
        notificationId: notification.notificationId,
        status: query.status,
        type: query.type ?? null,
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(
    cursor: string | undefined,
    query: GetNotificationsQueryDto,
  ): NotificationCursorPayload | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as
        | NotificationCursorPayload
        | null;

      if (
        !parsed ||
        Number.isNaN(Date.parse(parsed.lastEventAt)) ||
        !Number.isInteger(parsed.notificationId) ||
        parsed.notificationId <= 0 ||
        parsed.status !== query.status ||
        (parsed.type ?? null) !== (query.type ?? null)
      ) {
        throw new Error('Invalid cursor payload.');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Cursor is invalid for notifications.');
    }
  }

  private mapNotification(notification: Notification): NotificationResponse {
    const targetType = this.getTargetType(notification);
    const targetLabel = this.getTargetLabel(notification);
    const commentPreviewText = this.getCommentPreviewText(notification);
    const replyPreviewText = this.getReplyPreviewText(notification);

    return {
      notificationId: notification.notificationId,
      notificationType: notification.notificationType,
      eventsCount: notification.eventsCount,
      isRead: notification.isRead,
      isSeen: notification.isSeen,
      postId: notification.postId,
      postSlug: notification.post?.slug ?? null,
      postTitle: notification.post?.title ?? null,
      commentId: notification.commentId,
      postComplaintId: notification.postComplaintId,
      previewText: notification.previewText,
      commentPreviewText,
      replyPreviewText,
      targetType,
      targetLabel,
      targetRoutePayload: this.buildTargetRoutePayload(notification, targetType),
      bucketStart: notification.bucketStart,
      bucketSizeMinutes: notification.bucketSizeMinutes,
      lastEventAt: notification.lastEventAt,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      seenAt: notification.seenAt,
      lastActor: this.mapNotificationActor(notification.lastActor),
      violationReason: notification.postComplaint?.complaintReason ?? null,
    };
  }

  private mapNotificationActor(user: User | null | undefined): NotificationActorResponse | null {
    if (!user || user.deletedAt !== null) {
      return null;
    }

    return {
      userId: user.userId,
      name: user.name,
      username: user.username,
      photo: user.photo,
      isPremium: user.subscription?.status === SubscriptionStatus.ACTIVE,
    };
  }

  private async sendBrowserPushForGroupKey(
    recipientUserId: number,
    groupKey: string,
  ): Promise<void> {
    try {
      const notification = await this.notificationsRepository
        .createQueryBuilder('notification')
        .leftJoinAndSelect(
          'notification.lastActor',
          'lastActor',
          'lastActor.deleted_at IS NULL',
        )
        .leftJoinAndSelect('lastActor.subscription', 'lastActorSubscription')
        .leftJoinAndSelect('notification.post', 'post')
        .leftJoinAndSelect('notification.comment', 'comment')
        .leftJoinAndSelect('notification.postComplaint', 'postComplaint')
        .where('notification.recipient_user_id = :recipientUserId', { recipientUserId })
        .andWhere('notification.group_key = :groupKey', { groupKey })
        .getOne();

      if (!notification) {
        return;
      }

      const unreadCount = await this.notificationsRepository.countBy({
        recipientUserId,
        isRead: false,
      });
      const unseenCount = await this.getUnseenCount(recipientUserId);

      await this.browserPushNotificationsService.sendNotification(
        recipientUserId,
        this.mapNotification(notification),
        unreadCount,
        unseenCount,
      );
    } catch (error) {
      this.logger.warn(
        `Browser push dispatch failed recipientUserId=${recipientUserId} groupKey=${groupKey}`,
      );
    }
  }

  private applyQueryFilters(
    queryBuilder: SelectQueryBuilder<Notification>,
    query: GetNotificationsQueryDto,
  ): void {
    if (query.status === 'unread') {
      queryBuilder.andWhere('notification.is_read = false');
    }

    if (!query.type) {
      return;
    }

    if (query.type === 'mentions') {
      queryBuilder.andWhere('1 = 0');
      return;
    }

    const notificationTypes = NOTIFICATION_TYPE_GROUPS[query.type];
    queryBuilder.andWhere('notification.notification_type IN (:...notificationTypes)', {
      notificationTypes,
    });
  }

  private getTargetType(notification: Notification): NotificationTargetType {
    switch (notification.notificationType) {
      case NotificationType.USER_FOLLOWED:
        return 'profile';
      case NotificationType.COMMENT_LIKED:
      case NotificationType.COMMENT_REPLIED:
        return 'comment';
      case NotificationType.POST_VIOLATION_CONFIRMED:
        return 'system';
      case NotificationType.POST_LIKED:
      case NotificationType.POST_COMMENTED:
        return 'post';
    }
  }

  private getTargetLabel(notification: Notification): string {
    switch (notification.notificationType) {
      case NotificationType.USER_FOLLOWED:
        return 'Profile';
      case NotificationType.COMMENT_LIKED:
      case NotificationType.COMMENT_REPLIED:
        return 'Your comment';
      case NotificationType.POST_VIOLATION_CONFIRMED:
        return 'System';
      case NotificationType.POST_LIKED:
      case NotificationType.POST_COMMENTED:
        return 'Your post';
    }
  }

  private buildTargetRoutePayload(
    notification: Notification,
    targetType: NotificationTargetType,
  ): NotificationResponse['targetRoutePayload'] {
    if (targetType === 'profile') {
      return {
        postId: null,
        postSlug: null,
        commentId: null,
        postComplaintId: null,
        username: notification.lastActor?.deletedAt ? null : (notification.lastActor?.username ?? null),
      };
    }

    return {
      postId: notification.postId,
      postSlug: notification.post?.slug ?? null,
      commentId: notification.commentId,
      postComplaintId: notification.postComplaintId,
      username: null,
    };
  }

  private getCommentPreviewText(notification: Notification): string | null {
    switch (notification.notificationType) {
      case NotificationType.POST_COMMENTED:
        return notification.previewText;
      case NotificationType.COMMENT_LIKED:
      case NotificationType.COMMENT_REPLIED:
        return notification.comment?.commentText ?? null;
      default:
        return null;
    }
  }

  private getReplyPreviewText(notification: Notification): string | null {
    return notification.notificationType === NotificationType.COMMENT_REPLIED
      ? notification.previewText
      : null;
  }

  private async resolvePreviewText(
    manager: EntityManager,
    input: RecordNotificationInput,
  ): Promise<string | null> {
    switch (input.notificationType) {
      case NotificationType.POST_COMMENTED:
      case NotificationType.COMMENT_REPLIED:
        if (input.sourcePostCommentId === undefined || input.sourcePostCommentId === null) {
          return null;
        }

        return this.loadCommentPreviewText(manager, input.sourcePostCommentId);
      case NotificationType.COMMENT_LIKED:
        if (input.commentId === undefined || input.commentId === null) {
          return null;
        }

        return this.loadCommentPreviewText(manager, input.commentId);
      default:
        return null;
    }
  }

  private async resolvePreviewTextFromEvent(
    manager: EntityManager,
    event: NotificationEvent,
  ): Promise<string | null> {
    switch (event.notificationType) {
      case NotificationType.POST_COMMENTED:
      case NotificationType.COMMENT_REPLIED:
        return event.sourcePostCommentId
          ? this.loadCommentPreviewText(manager, event.sourcePostCommentId)
          : null;
      case NotificationType.COMMENT_LIKED:
        return event.commentId ? this.loadCommentPreviewText(manager, event.commentId) : null;
      default:
        return null;
    }
  }

  private async loadCommentPreviewText(
    manager: EntityManager,
    commentId: number,
  ): Promise<string | null> {
    const comment = await manager.getRepository(PostComment).findOne({
      where: { postCommentId: commentId },
      select: {
        commentText: true,
      },
    });

    return this.truncatePreviewText(comment?.commentText ?? null);
  }

  private truncatePreviewText(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    return normalized.length <= NOTIFICATION_PREVIEW_MAX_LENGTH
      ? normalized
      : `${normalized.slice(0, NOTIFICATION_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
  }

  private getUnseenCount(recipientUserId: number): Promise<number> {
    return this.notificationsRepository.countBy({
      recipientUserId,
      isSeen: false,
    });
  }
}
