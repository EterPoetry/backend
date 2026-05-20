import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { User } from '../users/entities/user.entity';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { NotificationEvent } from './entities/notification-event.entity';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './notification-type.enum';

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
  postId: number | null;
  commentId: number | null;
  postComplaintId: number | null;
  bucketStart: Date;
  bucketSizeMinutes: number;
  lastEventAt: Date;
  createdAt: Date;
  readAt: Date | null;
  lastActor: NotificationActorResponse | null;
}

export interface PaginatedNotificationsResponse {
  items: NotificationResponse[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
}

interface NotificationCursorPayload {
  lastEventAt: string;
  notificationId: number;
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

@Injectable()
export class NotificationsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(NotificationEvent)
    private readonly notificationEventsRepository: Repository<NotificationEvent>,
  ) {}

  async getNotifications(
    recipientUserId: number,
    query: GetNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponse> {
    const cursor = this.decodeCursor(query.cursor);
    const queryBuilder = this.notificationsRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect(
        'notification.lastActor',
        'lastActor',
        'lastActor.deleted_at IS NULL',
      )
      .leftJoinAndSelect('lastActor.subscription', 'lastActorSubscription')
      .where('notification.recipient_user_id = :recipientUserId', { recipientUserId })
      .orderBy('notification.last_event_at', 'DESC')
      .addOrderBy('notification.notification_id', 'DESC');

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

    return {
      items: pageRows.map((notification) => this.mapNotification(notification)),
      limit: query.limit,
      nextCursor: hasMore && lastRow ? this.encodeCursor(lastRow) : null,
      hasMore,
      unreadCount,
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
        readAt: () => 'NOW()',
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
        readAt: () => 'NOW()',
      })
      .where('recipient_user_id = :recipientUserId', { recipientUserId })
      .andWhere('is_read = false')
      .execute();

    return { ok: true };
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
    await this.removeNotificationEvents({
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
    await this.removeNotificationEvents({
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
    await this.removeNotificationEvents({
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
            "bucket_start",
            "bucket_size_minutes",
            "last_event_at",
            "created_at",
            "read_at"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 1, false, $8, $9, $10, $10, NULL)
          ON CONFLICT ("group_key")
          DO UPDATE SET
            "last_actor_user_id" = COALESCE(EXCLUDED."last_actor_user_id", "notifications"."last_actor_user_id"),
            "events_count" = "notifications"."events_count" + 1,
            "is_read" = false,
            "last_event_at" = EXCLUDED."last_event_at",
            "read_at" = NULL
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
        ],
      );
    });
  }

  private async removeNotificationEvents(filters: {
    sourcePostReactionId?: number;
    sourceCommentReactionId?: number;
    sourceFollowerId?: number;
    sourcePostCommentId?: number;
    sourcePostCommentIds?: number[];
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

  private encodeCursor(notification: Notification): string {
    return Buffer.from(
      JSON.stringify({
        lastEventAt: notification.lastEventAt.toISOString(),
        notificationId: notification.notificationId,
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor?: string): NotificationCursorPayload | null {
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
        parsed.notificationId <= 0
      ) {
        throw new Error('Invalid cursor payload.');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Cursor is invalid for notifications.');
    }
  }

  private mapNotification(notification: Notification): NotificationResponse {
    return {
      notificationId: notification.notificationId,
      notificationType: notification.notificationType,
      eventsCount: notification.eventsCount,
      isRead: notification.isRead,
      postId: notification.postId,
      commentId: notification.commentId,
      postComplaintId: notification.postComplaintId,
      bucketStart: notification.bucketStart,
      bucketSizeMinutes: notification.bucketSizeMinutes,
      lastEventAt: notification.lastEventAt,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      lastActor: this.mapNotificationActor(notification.lastActor),
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
}
