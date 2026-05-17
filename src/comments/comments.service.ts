import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { FileStorageService } from '../storage/file-storage.service';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { Post } from '../posts/entities/post.entity';
import { CommentReaction } from '../reactions/entities/comment-reaction.entity';
import { PostComment } from './entities/post-comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentSort, GetPostCommentsQueryDto } from './dto/get-post-comments-query.dto';
import { PopularCommentSnapshot } from './entities/popular-comment-snapshot.entity';
import { PopularCommentSnapshotItem } from './entities/popular-comment-snapshot-item.entity';

export interface CommentAuthorResponse {
  userId: number;
  name: string;
  username: string;
  photo: string | null;
  isPremium: boolean;
}

export interface CommentResponse {
  commentId: number;
  postId: number;
  commentText: string;
  replyToCommentId: number | null;
  repliesCount: number;
  likesCount: number;
  isLiked: boolean;
  isLikedByAuthor: boolean;
  author: CommentAuthorResponse;
}

export interface PaginatedCommentsResponse {
  items: CommentResponse[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CommentLikeMutationResponse {
  ok: true;
  likesCount: number;
}

interface PopularCommentsCursorPayload {
  snapshotId: number;
  lastRank: number;
}

const POPULAR_COMMENTS_SNAPSHOT_REFRESH_MINUTES = 5;
const POPULAR_COMMENTS_SNAPSHOT_RETENTION_HOURS = 1;

@Injectable()
export class CommentsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(PostComment)
    private readonly commentsRepository: Repository<PostComment>,
    @InjectRepository(CommentReaction)
    private readonly commentReactionsRepository: Repository<CommentReaction>,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(PopularCommentSnapshot)
    private readonly popularCommentSnapshotsRepository: Repository<PopularCommentSnapshot>,
    @InjectRepository(PopularCommentSnapshotItem)
    private readonly popularCommentSnapshotItemsRepository: Repository<PopularCommentSnapshotItem>,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async getPostComments(
    postId: number,
    requesterUserId: number | null,
    query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponse> {
    await this.requirePublishedPost(postId);

    if (query.sort === 'popular') {
      return this.getPopularCommentsPage(postId, requesterUserId, query, null);
    }

    const total = await this.countVisibleComments(postId, null);

    const queryBuilder = this.createTopLevelCommentsQuery(postId, requesterUserId)
      .andWhere('comment.reply_to_comment_id IS NULL');
    this.applyRegularCommentSort(queryBuilder, query.sort, query.cursor);

    const rows = await queryBuilder.limit(query.limit + 1).getRawMany<CommentRow>();
    const { pageRows, nextCursor, hasMore } = this.buildRegularCommentsPage(rows, query.limit);

    return {
      items: pageRows.map((row) => this.mapCommentRow(row)),
      total,
      limit: query.limit,
      nextCursor,
      hasMore,
    };
  }

  async getCommentReplies(
    commentId: number,
    requesterUserId: number | null,
    query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponse> {
    const parentComment = await this.requireCommentOnPublishedPost(commentId);

    if (parentComment.replyToCommentId !== null) {
      throw new BadRequestException('Replies can only be requested for top-level comments.');
    }

    const sort: CommentSort = 'oldest';
    const total = await this.countVisibleComments(parentComment.postId, parentComment.postCommentId);

    const queryBuilder = this.createCommentsBaseQuery(parentComment.postId, requesterUserId)
      .andWhere('comment.reply_to_comment_id = :commentId', { commentId: parentComment.postCommentId });
    this.applyRegularCommentSort(queryBuilder, sort, query.cursor);

    const rows = await queryBuilder.limit(query.limit + 1).getRawMany<CommentRow>();
    const { pageRows, nextCursor, hasMore } = this.buildRegularCommentsPage(rows, query.limit);

    return {
      items: pageRows.map((row) => this.mapCommentRow(row)),
      total,
      limit: query.limit,
      nextCursor,
      hasMore,
    };
  }

  async createComment(
    postId: number,
    requesterUserId: number,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    await this.requirePublishedPost(postId);
    const trimmedCommentText = dto.commentText.trim();

    if (!trimmedCommentText) {
      throw new BadRequestException('Comment text cannot be empty.');
    }

    let replyToCommentId: number | null = null;
    if (dto.replyToCommentId !== undefined) {
      const parentComment = await this.commentsRepository.findOne({
        where: { postCommentId: dto.replyToCommentId, postId },
      });

      if (!parentComment) {
        throw new NotFoundException('Parent comment not found.');
      }

      if (parentComment.replyToCommentId !== null) {
        throw new BadRequestException('Only one level of comment replies is allowed.');
      }

      replyToCommentId = parentComment.postCommentId;
    }

    const comment = await this.commentsRepository.save(
      this.commentsRepository.create({
        postId,
        commentAuthorId: requesterUserId,
        commentText: trimmedCommentText,
        replyToCommentId,
      }),
    );

    const row = await this.createCommentsBaseQuery(postId, requesterUserId)
      .andWhere('comment.post_comment_id = :commentId', { commentId: comment.postCommentId })
      .getRawOne<CommentRow>();

    if (!row) {
      throw new NotFoundException('Comment not found.');
    }

    return this.mapCommentRow(row);
  }

  async likeComment(
    commentId: number,
    requesterUserId: number,
  ): Promise<CommentLikeMutationResponse> {
    const comment = await this.requireCommentOnPublishedPost(commentId);

    const alreadyLiked = await this.commentReactionsRepository.exist({
      where: {
        postCommentId: comment.postCommentId,
        userId: requesterUserId,
      },
    });

    if (!alreadyLiked) {
      await this.commentReactionsRepository.save(
        this.commentReactionsRepository.create({
          postCommentId: comment.postCommentId,
          userId: requesterUserId,
        }),
      );
    }

    return {
      ok: true,
      likesCount: await this.getCommentLikesCount(comment.postCommentId),
    };
  }

  async unlikeComment(
    commentId: number,
    requesterUserId: number,
  ): Promise<CommentLikeMutationResponse> {
    const comment = await this.requireCommentOnPublishedPost(commentId);

    await this.commentReactionsRepository.delete({
      postCommentId: comment.postCommentId,
      userId: requesterUserId,
    });

    return {
      ok: true,
      likesCount: await this.getCommentLikesCount(comment.postCommentId),
    };
  }

  async deleteComment(commentId: number, requesterUserId: number): Promise<{ ok: true }> {
    const comment = await this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoinAndSelect('comment.post', 'post')
      .innerJoin('post.author', 'postAuthor', 'postAuthor.deleted_at IS NULL')
      .where('comment.post_comment_id = :commentId', { commentId })
      .andWhere('post.status = :status', { status: PostStatus.PUBLISHED })
      .getOne();

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    const canDelete =
      comment.commentAuthorId === requesterUserId || comment.post.authorId === requesterUserId;

    if (!canDelete) {
      throw new BadRequestException('You cannot delete this comment.');
    }

    await this.commentsRepository.delete([
      { postCommentId: comment.postCommentId },
      { replyToCommentId: comment.postCommentId },
    ]);

    return { ok: true };
  }

  private createCommentsBaseQuery(postId: number, requesterUserId: number | null) {
    return this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoin('comment.post', 'post')
      .innerJoin('post.author', 'postAuthor', 'postAuthor.deleted_at IS NULL')
      .innerJoin('comment.commentAuthor', 'author', 'author.deleted_at IS NULL')
      .leftJoin('author.subscription', 'authorSubscription')
      .leftJoin(
        CommentReaction,
        'requesterReaction',
        `requesterReaction.post_comment_id = comment.post_comment_id
         AND requesterReaction.user_id = :requesterUserId
         AND EXISTS (
           SELECT 1
           FROM users requesterReactionUser
           WHERE requesterReactionUser.user_id = requesterReaction.user_id
             AND requesterReactionUser.deleted_at IS NULL
         )`,
        { requesterUserId },
      )
      .leftJoin(
        CommentReaction,
        'authorReaction',
        `authorReaction.post_comment_id = comment.post_comment_id
         AND authorReaction.user_id = post.author_id
         AND EXISTS (
           SELECT 1
           FROM users authorReactionUser
           WHERE authorReactionUser.user_id = authorReaction.user_id
             AND authorReactionUser.deleted_at IS NULL
         )`,
      )
      .where('comment.post_id = :postId', { postId })
      .select([
        'comment.post_comment_id AS comment_id',
        'comment.post_id AS post_id',
        'comment.comment_text AS comment_text',
        'comment.reply_to_comment_id AS reply_to_comment_id',
        'author.user_id AS author_user_id',
        'author.name AS author_name',
        'author.username AS author_username',
        'author.photo AS author_photo',
        'authorSubscription.status AS author_subscription_status',
        'requesterReaction.comment_reaction_id AS requester_reaction_id',
        'authorReaction.comment_reaction_id AS author_reaction_id',
      ])
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(reaction.comment_reaction_id)')
          .from(CommentReaction, 'reaction')
          .innerJoin('reaction.user', 'reactionUser', 'reactionUser.deleted_at IS NULL')
          .where('reaction.post_comment_id = comment.post_comment_id');
      }, 'likes_count');
  }

  private createTopLevelCommentsQuery(postId: number, requesterUserId: number | null) {
    return this.createCommentsBaseQuery(postId, requesterUserId).addSelect((subQuery) => {
      return subQuery
        .select('COUNT(reply.post_comment_id)')
        .from(PostComment, 'reply')
        .innerJoin('reply.commentAuthor', 'replyAuthor', 'replyAuthor.deleted_at IS NULL')
        .where('reply.reply_to_comment_id = comment.post_comment_id');
    }, 'replies_count');
  }

  private buildRegularCommentsPage(rows: CommentRow[], limit: number) {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      pageRows,
      hasMore,
      nextCursor: hasMore && lastRow ? String(lastRow.comment_id) : null,
    };
  }

  private applyRegularCommentSort(
    queryBuilder: ReturnType<CommentsService['createCommentsBaseQuery']>,
    sort: CommentSort,
    cursor?: string,
  ): void {
    const cursorCommentId = this.parseNumericCursor(cursor);
    const isOldestFirst = sort === 'oldest';

    queryBuilder.orderBy('comment.post_comment_id', isOldestFirst ? 'ASC' : 'DESC');

    if (cursorCommentId === null) {
      return;
    }

    queryBuilder.andWhere(
      `comment.post_comment_id ${isOldestFirst ? '>' : '<'} :cursorCommentId`,
      { cursorCommentId },
    );
  }

  private async getPopularCommentsPage(
    postId: number,
    requesterUserId: number | null,
    query: GetPostCommentsQueryDto,
    replyToCommentId: number | null,
  ): Promise<PaginatedCommentsResponse> {
    const snapshot = query.cursor
      ? await this.getPinnedPopularCommentsSnapshot(query.cursor, postId, replyToCommentId)
      : await this.getLatestPopularCommentsSnapshot(postId, replyToCommentId);

    const cursor = this.decodePopularCommentsCursor(query.cursor);
    const rankedRows = await this.popularCommentSnapshotItemsRepository
      .createQueryBuilder('snapshotItem')
      .innerJoin(
        'post_comments',
        'comment',
        'comment.post_comment_id = snapshotItem.comment_id AND comment.post_id = :postId',
        { postId },
      )
      .where('snapshotItem.snapshot_id = :snapshotId', { snapshotId: snapshot.snapshotId })
      .andWhere('snapshotItem.rank > :lastRank', { lastRank: cursor?.lastRank ?? 0 })
      .orderBy('snapshotItem.rank', 'ASC')
      .limit(query.limit + 1)
      .select('snapshotItem.comment_id', 'commentId')
      .addSelect('snapshotItem.rank', 'rank')
      .getRawMany<{ commentId: string; rank: string }>();

    const hasMore = rankedRows.length > query.limit;
    const pageRows = hasMore ? rankedRows.slice(0, query.limit) : rankedRows;
    const commentIds = pageRows.map((row) => Number(row.commentId));

    if (!commentIds.length) {
      return {
        items: [],
        total: snapshot.totalComments,
        limit: query.limit,
        nextCursor: null,
        hasMore: false,
      };
    }

    const items = replyToCommentId === null
      ? await this.getTopLevelCommentsByIds(postId, requesterUserId, commentIds)
      : await this.getReplyCommentsByIds(postId, requesterUserId, replyToCommentId, commentIds);
    const itemsById = new Map(items.map((item) => [item.commentId, item]));
    const lastRank = Number(pageRows[pageRows.length - 1].rank);

    return {
      items: commentIds
        .map((commentId) => itemsById.get(commentId))
        .filter((item): item is CommentResponse => Boolean(item)),
      total: snapshot.totalComments,
      limit: query.limit,
      nextCursor: hasMore
        ? this.encodePopularCommentsCursor({
            snapshotId: snapshot.snapshotId,
            lastRank,
          })
        : null,
      hasMore,
    };
  }

  private parseNumericCursor(cursor?: string): number | null {
    if (!cursor) {
      return null;
    }

    const value = Number(cursor);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException('Cursor must be a positive integer.');
    }

    return value;
  }

  private parsePopularCursor(cursor?: string): PopularCommentsCursorPayload | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as
        | PopularCommentsCursorPayload
        | null;

      if (
        !parsed ||
        !Number.isInteger(parsed.snapshotId) ||
        parsed.snapshotId <= 0 ||
        !Number.isInteger(parsed.lastRank) ||
        parsed.lastRank < 0
      ) {
        throw new Error('Invalid popular comments cursor payload.');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Cursor is invalid for popular comments sorting.');
    }
  }

  private decodePopularCommentsCursor(cursor?: string): PopularCommentsCursorPayload | null {
    return this.parsePopularCursor(cursor);
  }

  private encodePopularCommentsCursor(payload: PopularCommentsCursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private async getPinnedPopularCommentsSnapshot(
    cursor: string,
    postId: number,
    replyToCommentId: number | null,
  ): Promise<PopularCommentSnapshot> {
    const decoded = this.decodePopularCommentsCursor(cursor);
    if (!decoded) {
      throw new BadRequestException('Popular comments cursor is missing.');
    }

    const snapshot = await this.createPopularCommentsSnapshotsScopeQuery(
      this.popularCommentSnapshotsRepository,
      postId,
      replyToCommentId,
    )
      .andWhere('snapshot.snapshot_id = :snapshotId', { snapshotId: decoded.snapshotId })
      .getOne();

    if (!snapshot || snapshot.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        message: 'Popular comments snapshot expired. Reload comments.',
        errorCode: 'POPULAR_COMMENTS_SNAPSHOT_EXPIRED',
      });
    }

    return snapshot;
  }

  private async getLatestPopularCommentsSnapshot(
    postId: number,
    replyToCommentId: number | null,
  ): Promise<PopularCommentSnapshot> {
    const latestSnapshot = await this.createPopularCommentsSnapshotsScopeQuery(
      this.popularCommentSnapshotsRepository,
      postId,
      replyToCommentId,
    )
      .orderBy('snapshot.generated_at', 'DESC')
      .getOne();

    if (latestSnapshot && this.isPopularCommentsSnapshotFresh(latestSnapshot)) {
      return latestSnapshot;
    }

    return this.createPopularCommentsSnapshot(postId, replyToCommentId);
  }

  private isPopularCommentsSnapshotFresh(snapshot: PopularCommentSnapshot): boolean {
    const refreshWindowMs = POPULAR_COMMENTS_SNAPSHOT_REFRESH_MINUTES * 60 * 1000;
    return Date.now() - snapshot.generatedAt.getTime() < refreshWindowMs;
  }

  private async createPopularCommentsSnapshot(
    postId: number,
    replyToCommentId: number | null,
  ): Promise<PopularCommentSnapshot> {
    return this.dataSource.transaction(async (manager) => {
      const snapshotsRepository = manager.getRepository(PopularCommentSnapshot);
      const snapshotItemsRepository = manager.getRepository(PopularCommentSnapshotItem);

      const latestSnapshot = await this.createPopularCommentsSnapshotsScopeQuery(
        snapshotsRepository,
        postId,
        replyToCommentId,
      )
        .orderBy('snapshot.generated_at', 'DESC')
        .getOne();

      if (latestSnapshot && this.isPopularCommentsSnapshotFresh(latestSnapshot)) {
        return latestSnapshot;
      }

      const rankedRows = await this.getRankedCommentsForSnapshot(manager, postId, replyToCommentId);
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + POPULAR_COMMENTS_SNAPSHOT_RETENTION_HOURS * 60 * 60 * 1000,
      );
      const snapshot = await snapshotsRepository.save(
        snapshotsRepository.create({
          postId,
          replyToCommentId,
          generatedAt: now,
          expiresAt,
          totalComments: rankedRows.length,
        }),
      );

      if (rankedRows.length) {
        await snapshotItemsRepository.save(
          rankedRows.map((row, index) =>
            snapshotItemsRepository.create({
              snapshotId: snapshot.snapshotId,
              commentId: Number(row.commentId),
              rank: index + 1,
              likesCount: Number(row.likesCount),
            }),
          ),
        );
      }

      await snapshotsRepository
        .createQueryBuilder()
        .delete()
        .where('expires_at <= NOW()')
        .execute();

      return snapshot;
    });
  }

  private getRankedCommentsForSnapshot(
    manager: EntityManager,
    postId: number,
    replyToCommentId: number | null,
  ) {
    const queryBuilder = manager
      .getRepository(PostComment)
      .createQueryBuilder('comment')
      .innerJoin('comment.commentAuthor', 'author', 'author.deleted_at IS NULL')
      .leftJoin(
        'comment_reactions',
        'commentReaction',
        `commentReaction.post_comment_id = comment.post_comment_id
         AND EXISTS (
           SELECT 1
           FROM users reactionUser
           WHERE reactionUser.user_id = commentReaction.user_id
             AND reactionUser.deleted_at IS NULL
         )`,
      )
      .where('comment.post_id = :postId', { postId })
      .select('comment.post_comment_id', 'commentId')
      .addSelect('COUNT(commentReaction.comment_reaction_id)', 'likesCount')
      .groupBy('comment.post_comment_id')
      .orderBy('COUNT(commentReaction.comment_reaction_id)', 'DESC')
      .addOrderBy('comment.post_comment_id', 'DESC');

    if (replyToCommentId === null) {
      queryBuilder.andWhere('comment.reply_to_comment_id IS NULL');
    } else {
      queryBuilder.andWhere('comment.reply_to_comment_id = :replyToCommentId', { replyToCommentId });
    }

    return queryBuilder.getRawMany<{ commentId: string; likesCount: string }>();
  }

  private async getTopLevelCommentsByIds(
    postId: number,
    requesterUserId: number | null,
    commentIds: number[],
  ): Promise<CommentResponse[]> {
    const rows = await this.createTopLevelCommentsQuery(postId, requesterUserId)
      .andWhere('comment.reply_to_comment_id IS NULL')
      .andWhere('comment.post_comment_id IN (:...commentIds)', { commentIds })
      .getRawMany<CommentRow>();

    return rows.map((row) => this.mapCommentRow(row));
  }

  private createPopularCommentsSnapshotsScopeQuery(
    repository: Repository<PopularCommentSnapshot>,
    postId: number,
    replyToCommentId: number | null,
  ) {
    const queryBuilder = repository
      .createQueryBuilder('snapshot')
      .where('snapshot.post_id = :postId', { postId });

    if (replyToCommentId === null) {
      queryBuilder.andWhere('snapshot.reply_to_comment_id IS NULL');
    } else {
      queryBuilder.andWhere('snapshot.reply_to_comment_id = :replyToCommentId', {
        replyToCommentId,
      });
    }

    return queryBuilder;
  }

  private async getReplyCommentsByIds(
    postId: number,
    requesterUserId: number | null,
    replyToCommentId: number,
    commentIds: number[],
  ): Promise<CommentResponse[]> {
    const rows = await this.createCommentsBaseQuery(postId, requesterUserId)
      .andWhere('comment.reply_to_comment_id = :replyToCommentId', { replyToCommentId })
      .andWhere('comment.post_comment_id IN (:...commentIds)', { commentIds })
      .getRawMany<CommentRow>();

    return rows.map((row) => this.mapCommentRow(row));
  }

  private mapCommentRow(row: CommentRow): CommentResponse {
    return {
      commentId: Number(row.comment_id),
      postId: Number(row.post_id),
      commentText: row.comment_text,
      replyToCommentId:
        row.reply_to_comment_id === null || row.reply_to_comment_id === undefined
          ? null
          : Number(row.reply_to_comment_id),
      repliesCount: Number(row.replies_count ?? 0),
      likesCount: Number(row.likes_count ?? 0),
      isLiked: row.requester_reaction_id !== null && row.requester_reaction_id !== undefined,
      isLikedByAuthor:
        row.author_reaction_id !== null && row.author_reaction_id !== undefined,
      author: {
        userId: Number(row.author_user_id),
        name: row.author_name,
        username: row.author_username,
        photo: this.fileStorageService.getFileUrl(row.author_photo),
        isPremium: row.author_subscription_status === SubscriptionStatus.ACTIVE,
      },
    };
  }

  private async requirePublishedPost(postId: number): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: {
        postId,
        status: PostStatus.PUBLISHED,
        author: { deletedAt: IsNull() },
      },
      relations: {
        author: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Published post not found.');
    }

    return post;
  }

  private async requireCommentOnPublishedPost(commentId: number): Promise<PostComment> {
    const comment = await this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoin('comment.post', 'post')
      .innerJoin('post.author', 'postAuthor', 'postAuthor.deleted_at IS NULL')
      .innerJoin('comment.commentAuthor', 'author', 'author.deleted_at IS NULL')
      .where('comment.post_comment_id = :commentId', { commentId })
      .andWhere('post.status = :status', { status: PostStatus.PUBLISHED })
      .getOne();

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    return comment;
  }

  private async getCommentLikesCount(commentId: number): Promise<number> {
    const result = await this.commentReactionsRepository
      .createQueryBuilder('reaction')
      .innerJoin('reaction.user', 'user', 'user.deleted_at IS NULL')
      .where('reaction.post_comment_id = :commentId', { commentId })
      .select('COUNT(reaction.comment_reaction_id)', 'count')
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  private async countVisibleComments(
    postId: number,
    replyToCommentId: number | null,
  ): Promise<number> {
    const queryBuilder = this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoin('comment.commentAuthor', 'author', 'author.deleted_at IS NULL')
      .where('comment.post_id = :postId', { postId });

    if (replyToCommentId === null) {
      queryBuilder.andWhere('comment.reply_to_comment_id IS NULL');
    } else {
      queryBuilder.andWhere('comment.reply_to_comment_id = :replyToCommentId', { replyToCommentId });
    }

    return queryBuilder.getCount();
  }
}

interface CommentRow {
  comment_id: number | string;
  post_id: number | string;
  comment_text: string;
  reply_to_comment_id: number | string | null;
  replies_count?: number | string | null;
  likes_count: number | string;
  requester_reaction_id: number | string | null;
  author_reaction_id: number | string | null;
  author_user_id: number | string;
  author_name: string;
  author_username: string;
  author_photo: string | null;
  author_subscription_status: SubscriptionStatus | null;
}
