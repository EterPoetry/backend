import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { PostAudioProcessingJobStatus } from '../common/enums/post-audio-processing-job-status.enum';
import { AudioAnalysisStatus } from '../common/enums/audio-analysis-status.enum';
import { Post } from './entities/post.entity';
import { buildPostSlug } from './post-slug.util';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
import {
  PostListenSession,
  PostListenSessionRange,
} from './entities/post-listen-session.entity';
import { PostTextPart } from './entities/post-text-part.entity';
import { PostAudioStorageService, UploadedPostAudio } from './post-audio-storage.service';
import { PostAudioTranscodingService } from './post-audio-transcoding.service';
import {
  GetMyPostsQueryDto,
  PostAuthorTypeFilter,
  MyPostsSortBy,
  SortOrder,
} from './dto/get-my-posts-query.dto';
import { GetFeedPostsQueryDto } from './dto/get-feed-posts-query.dto';
import { GetLikedPostsQueryDto } from './dto/get-liked-posts-query.dto';
import {
  GetPublishedPostsSearchQueryDto,
  PublishedPostsSearchSortBy,
} from './dto/get-published-posts-search-query.dto';
import { GetPopularPostsQueryDto } from './dto/get-popular-posts-query.dto';
import { PostTextSynchronizationItemDto } from './dto/update-post-text-synchronization.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Category } from '../categories/entities/category.entity';
import { PostCategory } from '../categories/entities/post-category.entity';
import { GetCategoriesQueryDto } from './dto/get-categories-query.dto';
import { User } from '../users/entities/user.entity';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PublicConfigService } from '../public-config/public-config.service';
import { FileStorageService } from '../storage/file-storage.service';
import { ReactionType } from '../common/enums/reaction-type.enum';
import { PostReaction } from '../reactions/entities/post-reaction.entity';
import { PopularPostSnapshot } from './entities/popular-post-snapshot.entity';
import { PopularPostSnapshotItem } from './entities/popular-post-snapshot-item.entity';
import { PostAudioAnalysis } from './entities/post-audio-analysis.entity';
import { PostAudioAnalysisService } from './post-audio-analysis.service';
import { AudioAnalysisV1Dto } from './audio-analysis.types';

export interface PostAuthorProfileResponse {
  userId: number;
  name: string;
  username: string;
  photo: string | null;
  isPremium: boolean;
}

export interface CategoryResponse {
  categoryId: number;
  categoryName: string;
  categoryDescription: string | null;
}

export interface PostResponse {
  postId: number;
  slug: string;
  title: string | null;
  description: string | null;
  text: string | null;
  audioFileName: string | null;
  audioFileUrl: string | null;
  audioDurationSeconds: number | null;
  status: PostStatus;
  listens: number;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  originAuthorName: string | null;
  textSynchronization?: PostTextSynchronizationItemResponse[];
  audioAnalysis?: AudioAnalysisV1Dto | null;
  categories: CategoryResponse[];
  authorId: number;
  author: PostAuthorProfileResponse;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostTextSynchronizationItemResponse {
  lineIndex: number;
  audioStartMomentMs: number;
}

export interface PaginatedPostsResponse {
  items: PostResponse[];
  total: number;
  offset: number;
}

export interface FeedPostsResponse {
  items: PostResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PopularPostsResponse {
  items: PostResponse[];
  snapshotId: number;
  snapshotGeneratedAt: Date;
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface StartPostListenResponse {
  token: string;
  listenedMs: number;
  trackDurationMs: number;
  isSuspicious: boolean;
}

export interface PostLikeMutationResponse {
  ok: true;
  likesCount: number;
}

export interface UpdatePostListenProgressResponse {
  listenedMs: number;
  isSuspicious: boolean;
  suspiciousReason: string | null;
}

export interface EndPostListenResponse extends UpdatePostListenProgressResponse {
  counted: boolean;
  countedAt: Date | null;
  thresholdReached: boolean;
}

interface ListenRequestContext {
  requesterUserId: number | null;
  guestSessionId: string | null;
  fingerprintHashSource: string | null;
}

interface ListenSessionTokenPayload {
  sessionId: number;
  postId: number;
  userId: number | null;
  guestSessionId: string | null;
  clientSessionId: string;
}

interface PopularPostsCursorPayload {
  lastRank: number;
}

interface FeedPostsCursorPayload {
  createdAt: string;
  postId: number;
}

const LISTEN_COMPLETION_RATIO = 0.8;
const LISTEN_COOLDOWN_HOURS = 12;
const GUEST_FINGERPRINT_WINDOW_MINUTES = 30;
const GUEST_FINGERPRINT_MAX_DISTINCT_SESSIONS = 10;
const LISTEN_LARGE_FORWARD_SEEK_MS = 15000;
const LISTEN_LARGE_BACKWARD_SEEK_MS = 5000;
const LISTEN_CONSECUTIVE_ANOMALY_LIMIT = 3;
const LISTEN_PROGRESS_MAX_SPEED_RATIO = 1.25;
const LISTEN_PROGRESS_TIME_SKEW_MS = 1500;
const LISTEN_POSITION_OVERSHOOT_MS = 3000;
const POPULAR_POSTS_WINDOW_DAYS = 30;
const POPULAR_SNAPSHOT_REFRESH_MINUTES = 5;
const POPULAR_SNAPSHOT_RETENTION_HOURS = 1;
const POPULAR_SNAPSHOT_MAX_POSTS = 200;

@Injectable()
export class PostsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(PostCategory)
    private readonly postCategoriesRepository: Repository<PostCategory>,
    @InjectRepository(PostTextPart)
    private readonly postTextPartsRepository: Repository<PostTextPart>,
    @InjectRepository(PostListenSession)
    private readonly postListenSessionsRepository: Repository<PostListenSession>,
    @InjectRepository(PostReaction)
    private readonly postReactionsRepository: Repository<PostReaction>,
    @InjectRepository(PopularPostSnapshot)
    private readonly popularPostSnapshotsRepository: Repository<PopularPostSnapshot>,
    @InjectRepository(PopularPostSnapshotItem)
    private readonly popularPostSnapshotItemsRepository: Repository<PopularPostSnapshotItem>,
    @InjectRepository(PostAudioAnalysis)
    private readonly postAudioAnalysisRepository: Repository<PostAudioAnalysis>,
    private readonly postAudioStorageService: PostAudioStorageService,
    private readonly postAudioTranscodingService: PostAudioTranscodingService,
    private readonly postAudioAnalysisService: PostAudioAnalysisService,
    private readonly publicConfigService: PublicConfigService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async createEmptyPost(authorId: number, audio: UploadedPostAudio): Promise<PostResponse> {
    const audioDurationSeconds = await this.postAudioTranscodingService.ensureDurationWithinLimit(
      audio,
      await this.getRecordingDurationLimitMinutes(authorId),
    );

    const sourceAudioFileName = await this.postAudioStorageService.saveSourceAudio(authorId, audio);
    try {
      const savedPost = await this.dataSource.transaction(async (manager) => {
        const savedPostEntity = await manager.getRepository(Post).save(
          manager.getRepository(Post).create({
            title: null,
            description: null,
            text: null,
            audioFileName: null,
            sourceAudioFileName,
            audioDurationSeconds,
            listens: 0,
            originAuthorName: null,
            status: PostStatus.PROCESSING,
            audioAnalysisStatus: AudioAnalysisStatus.PENDING,
            authorId,
            slug: '',
          }),
        );

        savedPostEntity.slug = buildPostSlug(savedPostEntity.postId, null);
        await manager.getRepository(Post).save(savedPostEntity);

        await manager.getRepository(PostAudioProcessingJob).save(
          manager.getRepository(PostAudioProcessingJob).create({
            postId: savedPostEntity.postId,
            sourceAudioFileName,
            status: PostAudioProcessingJobStatus.PENDING,
          }),
        );

        return savedPostEntity;
      });

      const post = await this.getPostById(savedPost.postId);
      if (!post) {
        throw new NotFoundException('Post not found.');
      }

      return this.buildPostResponse(post);
    } catch (error) {
      await this.postAudioStorageService.deleteAudio(sourceAudioFileName);
      throw error;
    }
  }

  async getPostById(postId: number, requesterUserId: number | null = null): Promise<Post | null> {
    return this.getOnePostWithComputedFields(
      this.createPostDetailsQueryBuilder(requesterUserId).where('post.post_id = :postId', { postId }),
    );
  }

  async getPostDetails(postId: number, requesterUserId: number | null): Promise<PostResponse> {
    const post = await this.requireReadablePost(postId, requesterUserId);
    return this.buildPostResponse(post, {
      audioAnalysis: await this.getPostAudioAnalysisDto(post.postId),
      includeAudioAnalysis: true,
    });
  }

  async getMyPosts(
    authorId: number,
    query: GetMyPostsQueryDto,
    requesterUserId: number | null = authorId,
  ): Promise<PaginatedPostsResponse> {
    return this.getPostsByAuthor(authorId, query, requesterUserId);
  }

  async getFeedPosts(userId: number, query: GetFeedPostsQueryDto): Promise<FeedPostsResponse> {
    const cursor = this.decodeFeedCursor(query.cursor);

    const queryBuilder = this.createPostDetailsQueryBuilder(userId)
      .where('post.status = :feedStatus', { feedStatus: PostStatus.PUBLISHED })
      .andWhere(
        `post.author_id IN (
          SELECT f.target_user_id
          FROM followers f
          INNER JOIN users feedTargetUser ON feedTargetUser.user_id = f.target_user_id
          WHERE f.follower_user_id = :feedUserId
            AND feedTargetUser.deleted_at IS NULL
        )`,
        { feedUserId: userId },
      );

    if (cursor) {
      queryBuilder.andWhere(
        '(post.createdAt < :cursorCreatedAt OR (post.createdAt = :cursorCreatedAt AND post.postId < :cursorPostId))',
        { cursorCreatedAt: cursor.createdAt, cursorPostId: cursor.postId },
      );
    }

    queryBuilder
      .orderBy('post.createdAt', 'DESC')
      .addOrderBy('post.postId', 'DESC')
      .distinct(true)
      .take(query.limit + 1);

    const posts = await this.getPostsWithComputedFields(queryBuilder);
    const hasMore = posts.length > query.limit;
    const pagePosts = hasMore ? posts.slice(0, query.limit) : posts;
    const lastPost = pagePosts[pagePosts.length - 1];

    return {
      items: pagePosts.map((post) => this.buildPostResponse(post, { includeTextSynchronization: false })),
      nextCursor:
        hasMore && lastPost
          ? this.encodeFeedCursor({ createdAt: lastPost.createdAt.toISOString(), postId: lastPost.postId })
          : null,
      hasMore,
    };
  }

  async getLikedPosts(userId: number, query: GetLikedPostsQueryDto): Promise<PaginatedPostsResponse> {
    const queryBuilder = this.createPostDetailsQueryBuilder(userId)
      .where('post.status = :likedFeedStatus', { likedFeedStatus: PostStatus.PUBLISHED })
      .andWhere(
        `EXISTS (SELECT 1 FROM post_reactions pr WHERE pr.post_id = post.post_id AND pr.user_id = :likedByUserId AND pr.reaction_type = :reactionType)`,
        { likedByUserId: userId },
      )
      .orderBy('post.createdAt', 'DESC')
      .addOrderBy('post.postId', 'DESC')
      .distinct(true)
      .skip(query.offset)
      .take(query.limit);

    const { posts, total } = await this.getPostsWithComputedFieldsAndCount(queryBuilder);

    return {
      items: posts.map((post) => this.buildPostResponse(post, { includeTextSynchronization: false })),
      total,
      offset: query.offset,
    };
  }

  async getPublishedPostsByAuthor(
    authorId: number,
    query: GetMyPostsQueryDto,
    requesterUserId: number | null = null,
  ): Promise<PaginatedPostsResponse> {
    return this.getPostsByAuthor(authorId, query, requesterUserId, PostStatus.PUBLISHED);
  }

  async getPopularPosts(
    query: GetPopularPostsQueryDto,
    requesterUserId: number | null = null,
  ): Promise<PopularPostsResponse> {
    const snapshot = query.snapshotId
      ? await this.getPinnedPopularSnapshot(query.snapshotId)
      : await this.getLatestPopularSnapshot();

    const cursor = this.decodePopularPostsCursor(query.cursor);
    const rankedRows = await this.popularPostSnapshotItemsRepository
      .createQueryBuilder('snapshotItem')
      .innerJoin(
        'posts',
        'post',
        'post.post_id = snapshotItem.post_id AND post.status = :status',
        { status: PostStatus.PUBLISHED },
      )
      .where('snapshotItem.snapshot_id = :snapshotId', { snapshotId: snapshot.snapshotId })
      .andWhere('snapshotItem.rank > :lastRank', { lastRank: cursor?.lastRank ?? 0 })
      .orderBy('snapshotItem.rank', 'ASC')
      .limit(query.limit + 1)
      .select('snapshotItem.post_id', 'postId')
      .addSelect('snapshotItem.rank', 'rank')
      .getRawMany<{ postId: string; rank: string }>();

    const hasMore = rankedRows.length > query.limit;
    const pageRows = hasMore ? rankedRows.slice(0, query.limit) : rankedRows;
    const postIds = pageRows.map((row) => Number(row.postId));

    if (!postIds.length) {
      return {
        items: [],
        snapshotId: snapshot.snapshotId,
        snapshotGeneratedAt: snapshot.generatedAt,
        total: snapshot.totalPosts,
        nextCursor: null,
        hasMore: false,
      };
    }

    const posts = await this.getPostsWithComputedFields(
      this.createPostDetailsQueryBuilder(requesterUserId).where('post.post_id IN (:...postIds)', { postIds }),
    );

    const postsById = new Map(posts.map((post) => [post.postId, post]));
    const lastRank = Number(pageRows[pageRows.length - 1].rank);

    return {
      items: postIds
        .map((postId) => postsById.get(postId))
        .filter((post): post is Post => Boolean(post))
        .map((post) => this.buildPostResponse(post, { includeTextSynchronization: false })),
      snapshotId: snapshot.snapshotId,
      snapshotGeneratedAt: snapshot.generatedAt,
      total: snapshot.totalPosts,
      nextCursor: hasMore ? this.encodePopularPostsCursor({ lastRank }) : null,
      hasMore,
    };
  }

  async searchPublishedPosts(
    query: GetPublishedPostsSearchQueryDto,
    requesterUserId: number | null = null,
  ): Promise<PaginatedPostsResponse> {
    if (query.sortBy === PublishedPostsSearchSortBy.POPULAR) {
      return this.searchPublishedPostsByPopularity(query, requesterUserId);
    }

    const queryBuilder = this.createPublishedPostsSearchBaseQuery(query, requesterUserId);
    this.applyPublishedPostsSearchSorting(queryBuilder, query.sortBy);

    queryBuilder.distinct(true);
    queryBuilder.skip(query.offset).take(query.limit);

    const { posts, total } = await this.getPostsWithComputedFieldsAndCount(queryBuilder);

    return {
      items: posts.map((post) => this.buildPostResponse(post, { includeTextSynchronization: false })),
      total,
      offset: query.offset,
    };
  }

  private async searchPublishedPostsByPopularity(
    query: GetPublishedPostsSearchQueryDto,
    requesterUserId: number | null,
  ): Promise<PaginatedPostsResponse> {
    const rankingQueryBuilder = this.postsRepository
      .createQueryBuilder('post')
      .innerJoin('post.author', 'author', 'author.deleted_at IS NULL')
      .where('post.status = :status', { status: PostStatus.PUBLISHED });

    if (query.search?.trim()) {
      rankingQueryBuilder.andWhere(
        `(COALESCE(post.title, '') ILIKE :search OR COALESCE(post.description, '') ILIKE :search OR COALESCE(post.text, '') ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }

    if (query.categoryId !== undefined) {
      rankingQueryBuilder.andWhere(
        `EXISTS (
          SELECT 1
          FROM post_categories popularity_post_category
          WHERE popularity_post_category.post_id = post.post_id
            AND popularity_post_category.category_id = :categoryId
        )`,
        { categoryId: query.categoryId },
      );
    }

    const total = await rankingQueryBuilder.getCount();

    const rankedRows = await rankingQueryBuilder
      .select('post.post_id', 'postId')
      .addSelect(
        `(
          post.listens
          + (
            SELECT COUNT(*)
            FROM post_reactions popularity_post_reaction
            INNER JOIN users popularity_reaction_user
              ON popularity_reaction_user.user_id = popularity_post_reaction.user_id
            WHERE popularity_post_reaction.post_id = post.post_id
              AND popularity_post_reaction.reaction_type = :reactionType
              AND popularity_reaction_user.deleted_at IS NULL
          ) * 3
          + (
            SELECT COUNT(*)
            FROM post_comments popularity_post_comment
            INNER JOIN users popularity_comment_author
              ON popularity_comment_author.user_id = popularity_post_comment.comment_author_id
            WHERE popularity_post_comment.post_id = post.post_id
              AND popularity_comment_author.deleted_at IS NULL
          ) * 5
        )`,
        'popularityscore',
      )
      .setParameter('reactionType', ReactionType.LIKE)
      .orderBy('popularityscore', 'DESC')
      .addOrderBy('post.created_at', 'DESC')
      .addOrderBy('post.post_id', 'DESC')
      .offset(query.offset)
      .limit(query.limit)
      .getRawMany<{ postId: string }>();

    const postIds = rankedRows.map((row) => Number(row.postId));
    if (!postIds.length) {
      return {
        items: [],
        total,
        offset: query.offset,
      };
    }

    const posts = await this.getPostsWithComputedFields(
      this.createPostDetailsQueryBuilder(requesterUserId).where('post.post_id IN (:...postIds)', { postIds }),
    );

    const postsById = new Map(posts.map((post) => [post.postId, post]));

    return {
      items: postIds
        .map((postId) => postsById.get(postId))
        .filter((post): post is Post => Boolean(post))
        .map((post) => this.buildPostResponse(post, { includeTextSynchronization: false })),
      total,
      offset: query.offset,
    };
  }

  async likePost(postId: number, requesterUserId: number): Promise<PostLikeMutationResponse> {
    const post = await this.requirePublishedPost(postId);

    const alreadyLiked = await this.postReactionsRepository.exist({
      where: {
        postId: post.postId,
        userId: requesterUserId,
      },
    });

    if (!alreadyLiked) {
      await this.postReactionsRepository.save(
        this.postReactionsRepository.create({
          postId: post.postId,
          userId: requesterUserId,
          reactionType: ReactionType.LIKE,
        }),
      );
    }

    return {
      ok: true,
      likesCount: await this.getPostLikesCount(post.postId),
    };
  }

  async unlikePost(postId: number, requesterUserId: number): Promise<PostLikeMutationResponse> {
    const post = await this.requirePublishedPost(postId);

    await this.postReactionsRepository.delete({
      postId: post.postId,
      userId: requesterUserId,
    });

    return {
      ok: true,
      likesCount: await this.getPostLikesCount(post.postId),
    };
  }

  async startPostListen(
    postId: number,
    listener: ListenRequestContext,
    clientSessionId: string,
  ): Promise<StartPostListenResponse> {
    const post = await this.getPostForListening(postId, listener.requesterUserId);
    const trackDurationMs = this.getTrackDurationMs(post.audioDurationSeconds);
    const fingerprintHash = this.createFingerprintHash(listener.fingerprintHashSource);
    const existingSession = await this.postListenSessionsRepository.findOne({
      where: this.buildSessionLookupWhere(postId, listener, clientSessionId),
    });

    if (existingSession) {
      const session =
        existingSession.userId === null
          ? await this.applyGuestFingerprintBurstCheck(existingSession, new Date())
          : existingSession;

      return {
        token: this.signListenSessionToken(session),
        listenedMs: session.listenedMs,
        trackDurationMs: session.trackDurationMs,
        isSuspicious: session.isSuspicious,
      };
    }

    const now = new Date();
    let session = await this.postListenSessionsRepository.save(
      this.postListenSessionsRepository.create({
        postId: post.postId,
        userId: listener.requesterUserId,
        guestSessionId: listener.requesterUserId === null ? listener.guestSessionId : null,
        fingerprintHash,
        clientSessionId,
        trackDurationMs,
        listenedMs: 0,
        maxPositionMs: 0,
        lastPositionMs: 0,
        lastProgressAt: now,
        listenedRanges: [],
        consecutiveAnomalyCount: 0,
        endedAt: null,
        listenCountedAt: null,
        isSuspicious: false,
        suspiciousReason: null,
      }),
    );

    if (session.userId === null) {
      session = await this.applyGuestFingerprintBurstCheck(session, now);
    }

    return {
      token: this.signListenSessionToken(session),
      listenedMs: session.listenedMs,
      trackDurationMs: session.trackDurationMs,
      isSuspicious: session.isSuspicious,
    };
  }

  async updatePostListenProgress(
    postId: number,
    listener: ListenRequestContext,
    token: string,
    positionMs: number,
  ): Promise<UpdatePostListenProgressResponse> {
    const tokenPayload = this.verifyListenSessionToken(token);
    const session = await this.getListenSessionForUpdate(postId, listener, tokenPayload);

    const updatedSession = await this.applyListenProgress(
      session,
      this.normalizePosition(positionMs, session.trackDurationMs),
      new Date(),
    );

    return {
      listenedMs: updatedSession.listenedMs,
      isSuspicious: updatedSession.isSuspicious,
      suspiciousReason: updatedSession.suspiciousReason,
    };
  }

  async endPostListen(
    postId: number,
    listener: ListenRequestContext,
    token: string,
    positionMs: number,
    clientSessionId?: string,
  ): Promise<EndPostListenResponse> {
    const tokenPayload = this.verifyListenSessionToken(token);
    if (clientSessionId && clientSessionId !== tokenPayload.clientSessionId) {
      throw new BadRequestException('Session id does not match the listen token.');
    }

    const session = await this.getListenSessionForUpdate(postId, listener, tokenPayload);
    const now = new Date();
    const updatedSession = await this.applyListenProgress(
      session,
      this.normalizePosition(positionMs, session.trackDurationMs),
      now,
    );

    const finalSession = await this.dataSource.transaction(async (manager) => {
      const sessionsRepository = manager.getRepository(PostListenSession);
      const postsRepository = manager.getRepository(Post);
      const lockedSession = await sessionsRepository.findOne({
        where: { postListenSessionId: updatedSession.postListenSessionId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedSession) {
        throw new NotFoundException('Listen session not found.');
      }

      if (lockedSession.endedAt) {
        return lockedSession;
      }

      const post = await postsRepository.findOne({
        where: { postId: lockedSession.postId },
        select: {
          postId: true,
          authorId: true,
          status: true,
        },
      });
      if (!post) {
        throw new NotFoundException('Post not found.');
      }

      const thresholdReached = this.hasReachedListenThreshold(lockedSession);
      let countedAt: Date | null = null;

      if (
        thresholdReached &&
        !lockedSession.isSuspicious &&
        (lockedSession.userId === null || post.authorId !== lockedSession.userId) &&
        post.status === PostStatus.PUBLISHED
      ) {
        await this.acquireListenCooldownLock(manager, lockedSession);

        const cooldownBoundary = this.getListenCooldownBoundary(now);
        const cooldownExists = await this.hasRecentCountedListen(
          sessionsRepository,
          lockedSession,
          cooldownBoundary,
        );
        const fingerprintAlreadyCounted = await this.hasCountedAnonymousFingerprint(
          sessionsRepository,
          lockedSession,
        );

        if (!cooldownExists && !fingerprintAlreadyCounted) {
          countedAt = now;
          await postsRepository.increment({ postId: lockedSession.postId }, 'listens', 1);
        } else if (fingerprintAlreadyCounted) {
          await sessionsRepository.update(lockedSession.postListenSessionId, {
            isSuspicious: true,
            suspiciousReason: 'fingerprint_already_counted',
          });
        }
      }

      await sessionsRepository.update(lockedSession.postListenSessionId, {
        endedAt: now,
        listenCountedAt: countedAt,
      });

      const finalLockedSession = await sessionsRepository.findOne({
        where: { postListenSessionId: lockedSession.postListenSessionId },
      });
      if (!finalLockedSession) {
        throw new NotFoundException('Listen session not found.');
      }

      return finalLockedSession;
    });

    return {
      listenedMs: finalSession.listenedMs,
      isSuspicious: finalSession.isSuspicious,
      suspiciousReason: finalSession.suspiciousReason,
      counted: finalSession.listenCountedAt !== null,
      countedAt: finalSession.listenCountedAt,
      thresholdReached: this.hasReachedListenThreshold(finalSession),
    };
  }

  private async getPostsByAuthor(
    authorId: number,
    query: GetMyPostsQueryDto,
    requesterUserId: number | null,
    status?: PostStatus,
  ): Promise<PaginatedPostsResponse> {
    const queryBuilder = this.createPostDetailsQueryBuilder(requesterUserId)
      .where('post.author_id = :authorId', { authorId });

    if (status) {
      queryBuilder.andWhere('post.status = :status', { status });
    }

    if (query.search?.trim()) {
      queryBuilder.andWhere(
        `(COALESCE(post.title, '') ILIKE :search OR COALESCE(post.description, '') ILIKE :search OR COALESCE(post.text, '') ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }

    if (query.authorType === PostAuthorTypeFilter.ORIGINAL) {
      queryBuilder.andWhere('post.origin_author_name IS NOT NULL');
    } else if (query.authorType === PostAuthorTypeFilter.AUTHOR) {
      queryBuilder.andWhere('post.origin_author_name IS NULL');
    }

    const sortColumn = this.mapSortByToColumn(query.sortBy);
    const sortDirection = query.sortOrder.toUpperCase() === SortOrder.ASC.toUpperCase() ? 'ASC' : 'DESC';
    const limit = query.limit;
    const offset = query.offset;

    queryBuilder.orderBy(sortColumn, sortDirection).addOrderBy('post.postId', 'DESC');
    queryBuilder.distinct(true);
    queryBuilder.skip(offset).take(limit);

    const { posts, total } = await this.getPostsWithComputedFieldsAndCount(queryBuilder);

    return {
      items: posts.map((post) => this.buildPostResponse(post, { includeTextSynchronization: false })),
      total,
      offset,
    };
  }

  private async getPinnedPopularSnapshot(snapshotId: number): Promise<PopularPostSnapshot> {
    const snapshot = await this.popularPostSnapshotsRepository.findOne({
      where: { snapshotId },
    });

    if (!snapshot) {
      throw new ConflictException({
        message: 'Popular feed snapshot expired. Reload feed.',
        errorCode: 'POPULAR_SNAPSHOT_EXPIRED',
      });
    }

    if (snapshot.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        message: 'Popular feed snapshot expired. Reload feed.',
        errorCode: 'POPULAR_SNAPSHOT_EXPIRED',
      });
    }

    return snapshot;
  }

  private async getLatestPopularSnapshot(): Promise<PopularPostSnapshot> {
    const latestSnapshot = await this.popularPostSnapshotsRepository
      .createQueryBuilder('snapshot')
      .orderBy('snapshot.generated_at', 'DESC')
      .getOne();

    if (latestSnapshot && this.isPopularSnapshotFresh(latestSnapshot)) {
      return latestSnapshot;
    }

    return this.createPopularSnapshot();
  }

  private isPopularSnapshotFresh(snapshot: PopularPostSnapshot): boolean {
    const refreshWindowMs = POPULAR_SNAPSHOT_REFRESH_MINUTES * 60 * 1000;
    return Date.now() - snapshot.generatedAt.getTime() < refreshWindowMs;
  }

  private async createPopularSnapshot(): Promise<PopularPostSnapshot> {
    return this.dataSource.transaction(async (manager) => {
      const snapshotsRepository = manager.getRepository(PopularPostSnapshot);
      const snapshotItemsRepository = manager.getRepository(PopularPostSnapshotItem);

      const latestSnapshot = await snapshotsRepository
        .createQueryBuilder('snapshot')
        .orderBy('snapshot.generated_at', 'DESC')
        .getOne();

      if (latestSnapshot && this.isPopularSnapshotFresh(latestSnapshot)) {
        return latestSnapshot;
      }

      const rankedRows = await manager
        .getRepository(Post)
        .createQueryBuilder('post')
        .innerJoin('post.author', 'author', 'author.deleted_at IS NULL')
        .leftJoin(
          'post_reactions',
          'postReaction',
          'postReaction.post_id = post.post_id AND postReaction.reaction_type = :reactionType',
          {
            reactionType: ReactionType.LIKE,
          },
        )
        .leftJoin(
          'users',
          'reactionUser',
          'reactionUser.user_id = postReaction.user_id AND reactionUser.deleted_at IS NULL',
        )
        .leftJoin(
          'post_comments',
          'postComment',
          'postComment.post_id = post.post_id',
        )
        .leftJoin(
          'users',
          'commentAuthor',
          'commentAuthor.user_id = postComment.comment_author_id AND commentAuthor.deleted_at IS NULL',
        )
        .where('post.status = :status', { status: PostStatus.PUBLISHED })
        .andWhere(`post.created_at >= NOW() - INTERVAL '${POPULAR_POSTS_WINDOW_DAYS} days'`)
        .select('post.post_id', 'postId')
        .addSelect(
          `(
            (
              post.listens
              + COUNT(DISTINCT CASE WHEN reactionUser.user_id IS NOT NULL THEN postReaction.post_reaction_id END) * 3
              + COUNT(DISTINCT CASE WHEN commentAuthor.user_id IS NOT NULL THEN postComment.post_comment_id END) * 5
            ) / POWER(
              GREATEST(EXTRACT(EPOCH FROM (NOW() - post.created_at)) / 3600 + 2, 2),
              0.8
            )
          )`,
          'score',
        )
        .groupBy('post.post_id')
        .orderBy('score', 'DESC')
        .addOrderBy('post.created_at', 'DESC')
        .addOrderBy('post.post_id', 'DESC')
        .limit(POPULAR_SNAPSHOT_MAX_POSTS)
        .getRawMany<{ postId: string; score: string }>();

      const now = new Date();
      const expiresAt = new Date(now.getTime() + POPULAR_SNAPSHOT_RETENTION_HOURS * 60 * 60 * 1000);
      const snapshot = await snapshotsRepository.save(
        snapshotsRepository.create({
          generatedAt: now,
          expiresAt,
          totalPosts: rankedRows.length,
        }),
      );

      if (rankedRows.length) {
        await snapshotItemsRepository.save(
          rankedRows.map((row, index) =>
            snapshotItemsRepository.create({
              snapshotId: snapshot.snapshotId,
              postId: Number(row.postId),
              rank: index + 1,
              score: Number(row.score),
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

  private encodePopularPostsCursor(payload: PopularPostsCursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private decodePopularPostsCursor(cursor?: string): PopularPostsCursorPayload | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as
        | PopularPostsCursorPayload
        | null;
      if (!parsed || !Number.isInteger(parsed.lastRank) || parsed.lastRank < 0) {
        throw new Error('Invalid popular cursor payload.');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Popular posts cursor is invalid.');
    }
  }

  private encodeFeedCursor(payload: FeedPostsCursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private decodeFeedCursor(cursor?: string): FeedPostsCursorPayload | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as
        | FeedPostsCursorPayload
        | null;
      if (!parsed || !Number.isInteger(parsed.postId)) {
        throw new Error('Invalid feed cursor payload.');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Feed cursor is invalid.');
    }
  }

  async markPostProcessingCompleted(
    post: Post,
    processedAudioFileName: string,
    audioAnalysis: AudioAnalysisV1Dto | null,
    audioAnalysisStatus: AudioAnalysisStatus,
  ): Promise<string | null> {
    const previousAudioFileName = post.audioFileName;
    const previousSourceAudioFileName = post.sourceAudioFileName;
    const nextStatus = this.isPostReadyForPublishing({
      ...post,
      audioFileName: processedAudioFileName,
      sourceAudioFileName: null,
    } as Post)
      ? PostStatus.PUBLISHED
      : PostStatus.DRAFT;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Post).update(post.postId, {
        audioFileName: processedAudioFileName,
        sourceAudioFileName: null,
        status: nextStatus,
        audioAnalysisStatus,
      });

      if (audioAnalysis) {
        await this.savePostAudioAnalysis(manager, post.postId, audioAnalysis);
        return;
      }

      await manager.getRepository(PostAudioAnalysis).delete({ postId: post.postId });
    });

    if (previousAudioFileName && previousAudioFileName !== processedAudioFileName) {
      await this.postAudioStorageService.deleteAudio(previousAudioFileName);
    }

    return previousSourceAudioFileName;
  }

  async reanalyzePostAudio(postId: number): Promise<void> {
    const post = await this.postsRepository.findOne({
      where: { postId },
      select: {
        postId: true,
        audioFileName: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    if (!post.audioFileName) {
      throw new BadRequestException('Post audio is not available for analysis.');
    }

    await this.postsRepository.update(postId, {
      audioAnalysisStatus: AudioAnalysisStatus.PROCESSING,
    });

    try {
      const audio = await this.postAudioStorageService.readAudio(post.audioFileName);
      const analysis = await this.postAudioAnalysisService.analyzeStoredAudio(audio);

      await this.dataSource.transaction(async (manager) => {
        await this.savePostAudioAnalysis(manager, postId, analysis);
        await manager.getRepository(Post).update(postId, {
          audioAnalysisStatus: AudioAnalysisStatus.READY,
        });
      });
    } catch (error) {
      await this.postsRepository.update(postId, {
        audioAnalysisStatus: AudioAnalysisStatus.FAILED,
      });
      throw error;
    }
  }

  async updatePost(
    postId: number,
    requesterUserId: number,
    dto: UpdatePostDto,
  ): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);
    const normalizedText = dto.text !== undefined ? this.normalizePostText(dto.text) : undefined;

    if (dto.title !== undefined) {
      post.title = dto.title;
    }

    if (dto.description !== undefined) {
      post.description = dto.description;
    }

    if (normalizedText !== undefined) {
      post.text = normalizedText;
    }

    if (dto.originAuthorName !== undefined) {
      post.originAuthorName = dto.originAuthorName;
    }

    if (dto.audioFileName !== undefined) {
      post.audioFileName = dto.audioFileName;
    }

    if (post.status === PostStatus.PROCESSING) {
      throw new ForbiddenException('Post is still processing and cannot be edited.');
    }

    await this.dataSource.transaction(async (manager) => {
      const updatePayload: Partial<Post> = {};

      if (dto.title !== undefined) {
        updatePayload.title = dto.title;
        updatePayload.slug = buildPostSlug(post.postId, dto.title);
      }

      if (dto.description !== undefined) {
        updatePayload.description = dto.description;
      }

      if (normalizedText !== undefined) {
        updatePayload.text = normalizedText;
      }

      if (dto.originAuthorName !== undefined) {
        updatePayload.originAuthorName = dto.originAuthorName;
      }

      if (dto.audioFileName !== undefined) {
        updatePayload.audioFileName = dto.audioFileName;
      }

      if (dto.categoryIds !== undefined) {
        await this.syncPostCategories(manager, post.postId, dto.categoryIds);
      }

      if (normalizedText !== undefined) {
        await this.removeOutdatedTextSynchronization(manager, post.postId, normalizedText);
      }

      if (Object.keys(updatePayload).length > 0) {
        await manager.getRepository(Post).update(post.postId, updatePayload);
      }
    });

    let updatedPost = await this.getPostById(post.postId);
    if (!updatedPost) {
      throw new NotFoundException('Post not found.');
    }

    const nextStatus = this.isPostReadyForPublishing(updatedPost)
      ? PostStatus.PUBLISHED
      : PostStatus.DRAFT;

    if (updatedPost.status !== nextStatus) {
      await this.postsRepository.update(updatedPost.postId, { status: nextStatus });
      updatedPost = await this.getPostById(updatedPost.postId);
      if (!updatedPost) {
        throw new NotFoundException('Post not found.');
      }
    }

    return this.buildPostResponse(updatedPost);
  }

  async updatePostTextSynchronization(
    postId: number,
    requesterUserId: number,
    textSynchronization: PostTextSynchronizationItemDto[],
  ): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);

    if (post.status === PostStatus.PROCESSING) {
      throw new ForbiddenException('Post is still processing and cannot be edited.');
    }

    this.validateTextSynchronization(post.text, post.audioDurationSeconds, textSynchronization);

    await this.dataSource.transaction(async (manager) => {
      await this.ensurePremiumUser(manager, requesterUserId);
      await this.syncPostTextParts(manager, post.postId, textSynchronization);
    });

    const updatedPost = await this.getPostById(post.postId);
    if (!updatedPost) {
      throw new NotFoundException('Post not found.');
    }

    return this.buildPostResponse(updatedPost);
  }

  async replacePostAudio(
    postId: number,
    requesterUserId: number,
    audio: UploadedPostAudio,
  ): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);

    if (post.status !== PostStatus.DRAFT) {
      throw new ForbiddenException('Audio can only be replaced for draft posts.');
    }

    const audioDurationSeconds = await this.postAudioTranscodingService.ensureDurationWithinLimit(
      audio,
      await this.getRecordingDurationLimitMinutes(requesterUserId),
    );
    const sourceAudioFileName = await this.postAudioStorageService.saveSourceAudio(
      requesterUserId,
      audio,
    );

    const previousAudioFileName = post.audioFileName;
    const previousSourceAudioFileName = post.sourceAudioFileName;

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(Post).update(post.postId, {
          audioFileName: null,
          sourceAudioFileName,
          audioDurationSeconds,
          status: PostStatus.PROCESSING,
          audioAnalysisStatus: AudioAnalysisStatus.PENDING,
        });
        await manager.getRepository(PostTextPart).delete({ postId: post.postId });
        await manager.getRepository(PostAudioAnalysis).delete({ postId: post.postId });

        await manager.getRepository(PostAudioProcessingJob).delete({ postId: post.postId });
        await manager.getRepository(PostAudioProcessingJob).save(
          manager.getRepository(PostAudioProcessingJob).create({
            postId: post.postId,
            sourceAudioFileName,
            status: PostAudioProcessingJobStatus.PENDING,
          }),
        );
      });
    } catch (error) {
      await this.postAudioStorageService.deleteAudio(sourceAudioFileName);
      throw error;
    }

    await this.postAudioStorageService.deleteAudio(previousAudioFileName);
    await this.postAudioStorageService.deleteAudio(previousSourceAudioFileName);

    const updatedPost = await this.getPostById(post.postId);
    if (!updatedPost) {
      throw new NotFoundException('Post not found.');
    }

    return this.buildPostResponse(updatedPost);
  }

  async deletePost(postId: number, requesterUserId: number): Promise<void> {
    const post = await this.requireOwnedPost(postId, requesterUserId);
    const audioFileName = post.audioFileName;
    const sourceAudioFileName = post.sourceAudioFileName;

    await this.postsRepository.delete({ postId: post.postId });
    await this.postAudioStorageService.deleteAudio(audioFileName);
    await this.postAudioStorageService.deleteAudio(sourceAudioFileName);
  }

  async getCategories(query: GetCategoriesQueryDto): Promise<CategoryResponse[]> {
    const queryBuilder = this.categoriesRepository
      .createQueryBuilder('category')
      .orderBy('category.category_name', 'ASC');

    if (query.search?.trim()) {
      queryBuilder.where(
        `(category.category_name ILIKE :search OR COALESCE(category.category_description, '') ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }

    const categories = await queryBuilder.getMany();
    return categories.map((category) => this.buildCategoryResponse(category));
  }

  buildPostResponse(
    post: Post,
    options: {
      includeTextSynchronization?: boolean;
      includeAudioAnalysis?: boolean;
      audioAnalysis?: AudioAnalysisV1Dto | null;
      isLiked?: boolean;
    } = {},
  ): PostResponse {
    const includeTextSynchronization = options.includeTextSynchronization ?? true;
    const includeAudioAnalysis = options.includeAudioAnalysis ?? false;
    const isLiked = options.isLiked ?? Boolean(post.requesterReactionId);

    return {
      postId: post.postId,
      slug: post.slug,
      title: post.title,
      description: post.description,
      text: post.text,
      audioFileName: post.audioFileName,
      audioFileUrl: this.postAudioStorageService.getAudioUrl(post.audioFileName),
      audioDurationSeconds: post.audioDurationSeconds,
      status: post.status,
      listens: post.listens,
      likesCount: post.likesCount ?? 0,
      commentsCount: post.commentsCount ?? 0,
      isLiked,
      originAuthorName: post.originAuthorName,
      ...(includeTextSynchronization
        ? {
            textSynchronization: (post.textParts ?? [])
              .slice()
              .sort((left, right) => left.lineIndex - right.lineIndex)
              .map((textPart) => ({
                lineIndex: textPart.lineIndex,
                audioStartMomentMs: textPart.audioStartMomentMs,
              })),
          }
        : {}),
      ...(includeAudioAnalysis ? { audioAnalysis: options.audioAnalysis ?? null } : {}),
      categories: (post.postCategories ?? [])
        .map((postCategory) => postCategory.category)
        .filter((category): category is Category => Boolean(category))
        .map((category) => this.buildCategoryResponse(category)),
      authorId: post.authorId,
      author: this.buildPostAuthorResponse(post.author),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  private async getPostAudioAnalysisDto(postId: number): Promise<AudioAnalysisV1Dto | null> {
    const audioAnalysis = await this.postAudioAnalysisRepository.findOne({
      where: { postId },
    });

    if (!audioAnalysis) {
      return null;
    }

    return {
      version: audioAnalysis.version as 1,
      durationMs: audioAnalysis.durationMs,
      frameMs: audioAnalysis.frameMs,
      features: audioAnalysis.features,
      frames: audioAnalysis.frames.toString('base64'),
      waveform: audioAnalysis.waveform.toString('base64'),
      accents: audioAnalysis.accents,
      silences: audioAnalysis.silences,
    };
  }

  private async savePostAudioAnalysis(
    manager: EntityManager,
    postId: number,
    audioAnalysis: AudioAnalysisV1Dto,
  ): Promise<void> {
    await manager.getRepository(PostAudioAnalysis).save(
      manager.getRepository(PostAudioAnalysis).create({
        postId,
        version: audioAnalysis.version,
        durationMs: audioAnalysis.durationMs,
        frameMs: audioAnalysis.frameMs,
        features: audioAnalysis.features,
        frames: Buffer.from(audioAnalysis.frames, 'base64'),
        waveform: Buffer.from(audioAnalysis.waveform, 'base64'),
        accents: audioAnalysis.accents,
        silences: audioAnalysis.silences,
      }),
    );
  }

  private mapSortByToColumn(sortBy: MyPostsSortBy): string {
    switch (sortBy) {
      case MyPostsSortBy.UPDATED_AT:
        return 'post.updatedAt';
      case MyPostsSortBy.TITLE:
        return 'post.title';
      case MyPostsSortBy.LISTENS:
        return 'post.listens';
      case MyPostsSortBy.CREATED_AT:
      default:
        return 'post.createdAt';
    }
  }

  private applyPublishedPostsSearchSorting(
    queryBuilder: ReturnType<PostsService['createPostDetailsQueryBuilder']>,
    sortBy: PublishedPostsSearchSortBy,
  ): void {
    if (sortBy === PublishedPostsSearchSortBy.OLDEST) {
      queryBuilder.orderBy('post.createdAt', 'ASC').addOrderBy('post.postId', 'ASC');
      return;
    }

    queryBuilder.orderBy('post.createdAt', 'DESC').addOrderBy('post.postId', 'DESC');
  }

  private createPublishedPostsSearchBaseQuery(
    query: GetPublishedPostsSearchQueryDto,
    requesterUserId: number | null = null,
  ) {
    const queryBuilder = this.createPostDetailsQueryBuilder(requesterUserId).where(
      'post.status = :status',
      { status: PostStatus.PUBLISHED },
    );

    if (query.search?.trim()) {
      queryBuilder.andWhere(
        `(COALESCE(post.title, '') ILIKE :search OR COALESCE(post.description, '') ILIKE :search OR COALESCE(post.text, '') ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }

    if (query.categoryId !== undefined) {
      queryBuilder.andWhere('postCategory.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }

    return queryBuilder;
  }

  private async requireOwnedPost(postId: number, requesterUserId: number): Promise<Post> {
    const post = await this.getPostById(postId);

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    if (post.authorId !== requesterUserId) {
      throw new ForbiddenException('You do not have access to this post.');
    }

    return post;
  }

  private async requirePublishedPost(postId: number): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: {
        postId,
        status: PostStatus.PUBLISHED,
        author: { deletedAt: IsNull() },
      },
      relations: { author: true },
      select: {
        postId: true,
        status: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    return post;
  }

  private async requireReadablePost(postId: number, requesterUserId: number | null): Promise<Post> {
    const post = await this.getPostById(postId);

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    if (post.status === PostStatus.PUBLISHED || post.authorId === requesterUserId) {
      return post;
    }

    throw new ForbiddenException('You do not have access to this post.');
  }

  private async syncPostCategories(
    manager: EntityManager,
    postId: number,
    categoryIds: number[],
  ): Promise<void> {
    const normalizedCategoryIds = [...new Set(categoryIds)];
    const categories = normalizedCategoryIds.length
      ? await manager.getRepository(Category).find({
          where: {
            categoryId: In(normalizedCategoryIds),
          },
        })
      : [];

    if (categories.length !== normalizedCategoryIds.length) {
      const existingCategoryIds = new Set(categories.map((category) => category.categoryId));
      const missingCategoryIds = normalizedCategoryIds.filter(
        (categoryId) => !existingCategoryIds.has(categoryId),
      );

      throw new NotFoundException(
        `Categories not found: ${missingCategoryIds.join(', ')}.`,
      );
    }

    await manager.getRepository(PostCategory).delete({ postId });

    if (!normalizedCategoryIds.length) {
      return;
    }

    await manager.getRepository(PostCategory).save(
      normalizedCategoryIds.map((categoryId) =>
        manager.getRepository(PostCategory).create({
          postId,
          categoryId,
        }),
      ),
    );
  }

  private async syncPostTextParts(
    manager: EntityManager,
    postId: number,
    textSynchronization: PostTextSynchronizationItemDto[],
  ): Promise<void> {
    await manager.getRepository(PostTextPart).delete({ postId });

    if (!textSynchronization.length) {
      return;
    }

    await manager.getRepository(PostTextPart).save(
      textSynchronization
        .slice()
        .sort((left, right) => left.lineIndex - right.lineIndex)
        .map((item) =>
          manager.getRepository(PostTextPart).create({
            postId,
            lineIndex: item.lineIndex,
            audioStartMomentMs: item.audioStartMomentMs,
          }),
        ),
    );
  }

  private async removeOutdatedTextSynchronization(
    manager: EntityManager,
    postId: number,
    text: string,
  ): Promise<void> {
    if (!this.hasNonEmptyValue(text)) {
      await manager.getRepository(PostTextPart).delete({ postId });
      return;
    }

    const lastLineIndex = text.split(/\r?\n/).length - 1;

    await manager
      .getRepository(PostTextPart)
      .createQueryBuilder()
      .delete()
      .where('post_id = :postId', { postId })
      .andWhere('line_index > :lastLineIndex', { lastLineIndex })
      .execute();
  }

  private buildCategoryResponse(category: Category): CategoryResponse {
    return {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      categoryDescription: category.categoryDescription,
    };
  }

  private buildPostAuthorResponse(author: User): PostAuthorProfileResponse {
    return {
      userId: author.userId,
      name: author.name,
      username: author.username,
      photo: this.fileStorageService.getFileUrl(author.photo),
      isPremium: author.subscription?.status === SubscriptionStatus.ACTIVE,
    };
  }

  private isPostReadyForPublishing(post: Post): boolean {
    return (
      this.hasNonEmptyValue(post.title) &&
      this.hasNonEmptyValue(post.text)
    );
  }

  private hasNonEmptyValue(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private normalizePostText(value: string): string {
    return value.replace(/(\r?\n)(?:[ \t]*\r?\n)+/g, '$1$1');
  }

  private getTrackDurationMs(audioDurationSeconds: number | null): number {
    if (!audioDurationSeconds || audioDurationSeconds <= 0) {
      throw new BadRequestException('Post audio duration is not available.');
    }

    return Math.round(audioDurationSeconds * 1000);
  }

  private async getRecordingDurationLimitMinutes(userId: number): Promise<number> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { subscription: true },
    });

    const isPremium = user?.subscription?.status === SubscriptionStatus.ACTIVE;
    return this.publicConfigService.getRecordingDurationLimitMinutes(isPremium);
  }

  private createPostDetailsQueryBuilder(_requesterUserId: number | null = null) {
    const queryBuilder = this.postsRepository
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.author', 'author', 'author.deleted_at IS NULL')
      .leftJoinAndSelect('author.subscription', 'authorSubscription')
      .leftJoinAndSelect('post.textParts', 'textPart')
      .leftJoinAndSelect('post.postCategories', 'postCategory')
      .leftJoinAndSelect('postCategory.category', 'category')
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(postReactionCount.post_reaction_id)')
            .from(PostReaction, 'postReactionCount')
            .innerJoin('postReactionCount.user', 'postReactionUser', 'postReactionUser.deleted_at IS NULL')
            .where('postReactionCount.post_id = post.post_id')
            .andWhere('postReactionCount.reaction_type = :reactionType'),
        'post_likes_count',
      )
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(postCommentCount.post_comment_id)')
            .from('post_comments', 'postCommentCount')
            .innerJoin(
              'users',
              'postCommentAuthor',
              'postCommentAuthor.user_id = postCommentCount.comment_author_id AND postCommentAuthor.deleted_at IS NULL',
            )
            .where('postCommentCount.post_id = post.post_id'),
        'post_comments_count',
      )
      .setParameter('reactionType', ReactionType.LIKE);

    if (_requesterUserId !== null) {
      queryBuilder.addSelect(
        (subQuery) =>
          subQuery
            .select('requesterReaction.post_reaction_id')
            .from(PostReaction, 'requesterReaction')
            .innerJoin('requesterReaction.user', 'requesterReactionUser', 'requesterReactionUser.deleted_at IS NULL')
            .where('requesterReaction.post_id = post.post_id')
            .andWhere('requesterReaction.user_id = :requesterUserId')
            .andWhere('requesterReaction.reaction_type = :reactionType')
            .limit(1),
        'post_requester_reaction_id',
      );
      queryBuilder.setParameter('requesterUserId', _requesterUserId);
    }

    return queryBuilder;
  }

  private async getOnePostWithComputedFields(
    queryBuilder: ReturnType<PostsService['createPostDetailsQueryBuilder']>,
  ): Promise<Post | null> {
    const posts = await this.getPostsWithComputedFields(queryBuilder);
    return posts[0] ?? null;
  }

  private async getPostsWithComputedFields(
    queryBuilder: ReturnType<PostsService['createPostDetailsQueryBuilder']>,
  ): Promise<Post[]> {
    const { raw, entities } = await queryBuilder.getRawAndEntities();
    this.applyComputedPostFields(entities, raw);
    return entities;
  }

  private async getPostsWithComputedFieldsAndCount(
    queryBuilder: ReturnType<PostsService['createPostDetailsQueryBuilder']>,
  ): Promise<{ posts: Post[]; total: number }> {
    const [result, total] = await Promise.all([
      queryBuilder.getRawAndEntities(),
      queryBuilder.clone().skip(undefined).take(undefined).offset(undefined).limit(undefined).getCount(),
    ]);

    this.applyComputedPostFields(result.entities, result.raw);

    return {
      posts: result.entities,
      total,
    };
  }

  private applyComputedPostFields(entities: Post[], rawRows: Record<string, unknown>[]): void {
    const computedByPostId = new Map<
      number,
      { likesCount: number; commentsCount: number; requesterReactionId: number | null }
    >();

    for (const row of rawRows) {
      const postId = Number(row.post_post_id);

      if (!Number.isFinite(postId) || computedByPostId.has(postId)) {
        continue;
      }

      const requesterReactionIdRaw = row.post_requester_reaction_id;
      computedByPostId.set(postId, {
        likesCount: Number(row.post_likes_count ?? 0),
        commentsCount: Number(row.post_comments_count ?? 0),
        requesterReactionId:
          requesterReactionIdRaw === null || requesterReactionIdRaw === undefined
            ? null
            : Number(requesterReactionIdRaw),
      });
    }

    for (const entity of entities) {
      const computed = computedByPostId.get(entity.postId);
      entity.likesCount = computed?.likesCount ?? 0;
      entity.commentsCount = computed?.commentsCount ?? 0;
      entity.requesterReactionId = computed?.requesterReactionId ?? null;
    }
  }

  private async getPostLikesCount(postId: number): Promise<number> {
    const result = await this.postReactionsRepository
      .createQueryBuilder('reaction')
      .innerJoin('reaction.user', 'user', 'user.deleted_at IS NULL')
      .where('reaction.post_id = :postId', { postId })
      .andWhere('reaction.reaction_type = :reactionType', {
        reactionType: ReactionType.LIKE,
      })
      .select('COUNT(reaction.post_reaction_id)', 'count')
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  private validateTextSynchronization(
    text: string | null,
    audioDurationSeconds: number | null,
    textSynchronization: PostTextSynchronizationItemDto[],
  ): void {
    if (!this.hasNonEmptyValue(text)) {
      throw new BadRequestException(
        'Text synchronization can only be saved when the post text is filled.',
      );
    }

    const lines = (text ?? '').split(/\r?\n/);
    const maxTimestampMs =
      typeof audioDurationSeconds === 'number' ? Math.round(audioDurationSeconds * 1000) : null;
    const firstLineSynchronization = textSynchronization.find((item) => item.lineIndex === 0);

    if (textSynchronization.length > 0) {
      if (!firstLineSynchronization) {
        throw new BadRequestException(
          'Text synchronization must include lineIndex 0 when synchronization is provided.',
        );
      }

      if (firstLineSynchronization.audioStartMomentMs !== 0) {
        throw new BadRequestException(
          'Text synchronization for lineIndex 0 must start at 0 milliseconds.',
        );
      }
    }

    const sortedSynchronization = textSynchronization
      .slice()
      .sort((left, right) => left.lineIndex - right.lineIndex);

    for (let index = 1; index < sortedSynchronization.length; index += 1) {
      const previousItem = sortedSynchronization[index - 1];
      const currentItem = sortedSynchronization[index];

      if (currentItem.audioStartMomentMs <= previousItem.audioStartMomentMs) {
        throw new BadRequestException(
          `Text synchronization timestamps must increase with line order: lineIndex ${currentItem.lineIndex} must be greater than lineIndex ${previousItem.lineIndex}.`,
        );
      }
    }

    for (const item of textSynchronization) {
      if (item.lineIndex >= lines.length) {
        throw new BadRequestException(
          `Text synchronization lineIndex ${item.lineIndex} does not exist in post text.`,
        );
      }

      if (!this.hasNonEmptyValue(lines[item.lineIndex])) {
        throw new BadRequestException(
          `Text synchronization lineIndex ${item.lineIndex} points to an empty line.`,
        );
      }

      if (maxTimestampMs !== null && item.audioStartMomentMs > maxTimestampMs) {
        throw new BadRequestException(
          `Text synchronization timestamp ${item.audioStartMomentMs} exceeds audio duration.`,
        );
      }
    }
  }

  private async ensurePremiumUser(manager: EntityManager, userId: number): Promise<void> {
    const user = await manager.getRepository(User).findOne({
      where: { userId },
      relations: { subscription: true },
    });

    if (user?.subscription?.status !== SubscriptionStatus.ACTIVE) {
      throw new ForbiddenException('Text synchronization is available only for premium users.');
    }
  }

  private async getPostForListening(postId: number, requesterUserId: number | null): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: {
        postId,
        author: { deletedAt: IsNull() },
      },
      relations: { author: true },
      select: {
        postId: true,
        authorId: true,
        status: true,
        audioDurationSeconds: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    if (post.status !== PostStatus.PUBLISHED && post.authorId !== requesterUserId) {
      throw new ForbiddenException('You do not have access to this post.');
    }

    return post;
  }

  private signListenSessionToken(session: PostListenSession): string {
    const payload = Buffer.from(
      JSON.stringify({
        sessionId: session.postListenSessionId,
        postId: session.postId,
        userId: session.userId,
        guestSessionId: session.guestSessionId,
        clientSessionId: session.clientSessionId,
      } satisfies ListenSessionTokenPayload),
    ).toString('base64url');

    const signature = this.signListenTokenPayload(payload);
    return `${payload}.${signature}`;
  }

  private verifyListenSessionToken(token: string): ListenSessionTokenPayload {
    const [payloadPart, signaturePart] = token.split('.');
    if (!payloadPart || !signaturePart) {
      throw new BadRequestException('Listen token is invalid.');
    }

    const expectedSignature = this.signListenTokenPayload(payloadPart);
    const receivedBuffer = Buffer.from(signaturePart, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new BadRequestException('Listen token is invalid.');
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Listen token is invalid.');
    }

    if (
      typeof parsedPayload !== 'object' ||
      parsedPayload === null ||
      !Number.isInteger((parsedPayload as { sessionId?: unknown }).sessionId) ||
      !Number.isInteger((parsedPayload as { postId?: unknown }).postId) ||
      !this.isNullableInteger((parsedPayload as { userId?: unknown }).userId) ||
      !this.isNullableString((parsedPayload as { guestSessionId?: unknown }).guestSessionId) ||
      typeof (parsedPayload as { clientSessionId?: unknown }).clientSessionId !== 'string'
    ) {
      throw new BadRequestException('Listen token is invalid.');
    }

    return parsedPayload as ListenSessionTokenPayload;
  }

  private signListenTokenPayload(payload: string): string {
    return createHmac('sha256', this.getListenSessionSecret()).update(payload).digest('hex');
  }

  private getListenSessionSecret(): string {
    return this.configService.get<string>(
      'POST_LISTEN_SESSION_SECRET',
      this.configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
    );
  }

  private async getListenSessionForUpdate(
    postId: number,
    listener: ListenRequestContext,
    tokenPayload: ListenSessionTokenPayload,
  ): Promise<PostListenSession> {
    const isAuthenticatedRequest = listener.requesterUserId !== null;

    if (
      tokenPayload.postId !== postId ||
      tokenPayload.userId !== listener.requesterUserId ||
      (!isAuthenticatedRequest && tokenPayload.guestSessionId !== listener.guestSessionId)
    ) {
      throw new BadRequestException('Listen token does not match the request.');
    }

    const session = await this.postListenSessionsRepository.findOne({
      where:
        listener.requesterUserId !== null
          ? {
              postListenSessionId: tokenPayload.sessionId,
              postId,
              userId: listener.requesterUserId,
            }
          : {
              postListenSessionId: tokenPayload.sessionId,
              postId,
              userId: IsNull(),
              guestSessionId: this.requireGuestSessionId(listener.guestSessionId),
            },
    });

    if (!session) {
      throw new NotFoundException('Listen session not found.');
    }

    if (session.clientSessionId !== tokenPayload.clientSessionId) {
      throw new BadRequestException('Listen token does not match the session.');
    }

    if (session.endedAt) {
      throw new BadRequestException('Listen session has already ended.');
    }

    return session;
  }

  private async applyListenProgress(
    session: PostListenSession,
    positionMs: number,
    now: Date,
  ): Promise<PostListenSession> {
    const elapsedRealMs = session.lastProgressAt
      ? Math.max(0, now.getTime() - session.lastProgressAt.getTime())
      : null;
    const previousPositionMs = session.lastPositionMs ?? 0;
    const deltaPositionMs = positionMs - previousPositionMs;

    if (positionMs > session.trackDurationMs + LISTEN_POSITION_OVERSHOOT_MS) {
      return this.markListenSessionSuspicious(session, 'position_out_of_range', now);
    }

    const advancedTooFast =
      elapsedRealMs !== null &&
      deltaPositionMs >
        elapsedRealMs * LISTEN_PROGRESS_MAX_SPEED_RATIO + LISTEN_PROGRESS_TIME_SKEW_MS;
    const isLargeBackwardSeek = deltaPositionMs <= -LISTEN_LARGE_BACKWARD_SEEK_MS;
    const isLargeForwardSeek =
      elapsedRealMs !== null &&
      deltaPositionMs >
        elapsedRealMs * LISTEN_PROGRESS_MAX_SPEED_RATIO +
          LISTEN_PROGRESS_TIME_SKEW_MS +
          LISTEN_LARGE_FORWARD_SEEK_MS;
    const isAnomalousEvent = advancedTooFast || isLargeBackwardSeek || isLargeForwardSeek;
    const consecutiveAnomalyCount = isAnomalousEvent
      ? session.consecutiveAnomalyCount + 1
      : 0;

    if (consecutiveAnomalyCount >= LISTEN_CONSECUTIVE_ANOMALY_LIMIT) {
      const reason = advancedTooFast
        ? 'progress_consistently_too_fast'
        : 'repeated_large_seek_jumps';
      return this.markListenSessionSuspicious(session, reason, now);
    }

    const listenedRanges = this.getNormalizedListenedRanges(session);
    const shouldCreditProgress = deltaPositionMs > 0 && !advancedTooFast;
    const creditedEndMs = shouldCreditProgress
      ? Math.min(positionMs, session.trackDurationMs)
      : null;
    const updatedRanges =
      creditedEndMs !== null
        ? this.mergeListenedRanges(listenedRanges, {
            startMs: Math.min(previousPositionMs, creditedEndMs),
            endMs: Math.max(previousPositionMs, creditedEndMs),
          })
        : listenedRanges;

    await this.postListenSessionsRepository.update(session.postListenSessionId, {
      listenedMs: this.getTotalListenedMs(updatedRanges),
      listenedRanges: updatedRanges,
      maxPositionMs: Math.max(session.maxPositionMs, positionMs),
      lastPositionMs: positionMs,
      lastProgressAt: now,
      consecutiveAnomalyCount,
    });

    const updatedSession = await this.postListenSessionsRepository.findOne({
      where: { postListenSessionId: session.postListenSessionId },
    });
    if (!updatedSession) {
      throw new NotFoundException('Listen session not found.');
    }

    return updatedSession;
  }

  private async markListenSessionSuspicious(
    session: PostListenSession,
    reason: string,
    now: Date,
  ): Promise<PostListenSession> {
    await this.postListenSessionsRepository.update(session.postListenSessionId, {
      isSuspicious: true,
      suspiciousReason: reason,
      lastProgressAt: now,
    });

    const updatedSession = await this.postListenSessionsRepository.findOne({
      where: { postListenSessionId: session.postListenSessionId },
    });
    if (!updatedSession) {
      throw new NotFoundException('Listen session not found.');
    }

    return updatedSession;
  }

  private normalizePosition(positionMs: number, trackDurationMs: number): number {
    return Math.min(positionMs, trackDurationMs + LISTEN_POSITION_OVERSHOOT_MS);
  }

  private getNormalizedListenedRanges(
    session: PostListenSession,
  ): PostListenSessionRange[] {
    const ranges = session.listenedRanges ?? [];
    if (ranges.length > 0) {
      return this.mergeListenedRanges([], ...ranges);
    }

    const fallbackEndMs = Math.min(
      session.trackDurationMs,
      Math.max(session.listenedMs, session.maxPositionMs),
    );
    if (fallbackEndMs <= 0) {
      return [];
    }

    return [{ startMs: 0, endMs: fallbackEndMs }];
  }

  private mergeListenedRanges(
    existingRanges: PostListenSessionRange[],
    ...rangesToAdd: PostListenSessionRange[]
  ): PostListenSessionRange[] {
    const normalizedRanges = [...existingRanges, ...rangesToAdd]
      .map((range) => ({
        startMs: Math.max(0, Math.min(range.startMs, range.endMs)),
        endMs: Math.max(0, Math.max(range.startMs, range.endMs)),
      }))
      .filter((range) => range.endMs > range.startMs)
      .sort((left, right) => left.startMs - right.startMs);

    if (normalizedRanges.length === 0) {
      return [];
    }

    const mergedRanges: PostListenSessionRange[] = [normalizedRanges[0]];
    for (const range of normalizedRanges.slice(1)) {
      const previousRange = mergedRanges[mergedRanges.length - 1];
      if (range.startMs <= previousRange.endMs) {
        previousRange.endMs = Math.max(previousRange.endMs, range.endMs);
        continue;
      }

      mergedRanges.push(range);
    }

    return mergedRanges;
  }

  private getTotalListenedMs(ranges: PostListenSessionRange[]): number {
    return ranges.reduce((total, range) => total + (range.endMs - range.startMs), 0);
  }

  private hasReachedListenThreshold(session: PostListenSession): boolean {
    return session.listenedMs >= Math.ceil(session.trackDurationMs * LISTEN_COMPLETION_RATIO);
  }

  private getListenCooldownBoundary(now: Date): Date {
    return new Date(now.getTime() - LISTEN_COOLDOWN_HOURS * 60 * 60 * 1000);
  }

  private createFingerprintHash(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return createHash('sha256').update(value).digest('hex');
  }

  private buildSessionLookupWhere(
    postId: number,
    listener: ListenRequestContext,
    clientSessionId: string,
  ) {
    return listener.requesterUserId !== null
      ? {
          postId,
          userId: listener.requesterUserId,
          clientSessionId,
        }
      : {
          postId,
          userId: IsNull(),
          guestSessionId: this.requireGuestSessionId(listener.guestSessionId),
          clientSessionId,
        };
  }

  private requireGuestSessionId(guestSessionId: string | null): string {
    if (!guestSessionId) {
      throw new BadRequestException('Guest session is required.');
    }

    return guestSessionId;
  }

  private async applyGuestFingerprintBurstCheck(
    session: PostListenSession,
    now: Date,
  ): Promise<PostListenSession> {
    if (
      session.userId !== null ||
      session.isSuspicious ||
      !session.fingerprintHash ||
      !session.guestSessionId
    ) {
      return session;
    }

    const boundary = new Date(now.getTime() - GUEST_FINGERPRINT_WINDOW_MINUTES * 60 * 1000);
    const rawResult = await this.postListenSessionsRepository
      .createQueryBuilder('session')
      .select('COUNT(DISTINCT session.guest_session_id)', 'count')
      .where('session.user_id IS NULL')
      .andWhere('session.fingerprint_hash = :fingerprintHash', {
        fingerprintHash: session.fingerprintHash,
      })
      .andWhere('session.created_at > :boundary', { boundary })
      .getRawOne<{ count: string }>();

    const distinctGuestSessions = Number(rawResult?.count ?? 0);
    if (distinctGuestSessions < GUEST_FINGERPRINT_MAX_DISTINCT_SESSIONS) {
      return session;
    }

    return this.markListenSessionSuspicious(session, 'guest_fingerprint_too_many_sessions', now);
  }

  private async acquireListenCooldownLock(
    manager: EntityManager,
    session: PostListenSession,
  ): Promise<void> {
    if (session.userId !== null) {
      await manager.query(`SELECT pg_advisory_xact_lock($1, $2)`, [session.userId, session.postId]);
      return;
    }

    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1), $2)`, [
      session.guestSessionId,
      session.postId,
    ]);
  }

  private async hasRecentCountedListen(
    sessionsRepository: Repository<PostListenSession>,
    session: PostListenSession,
    cooldownBoundary: Date,
  ): Promise<boolean> {
    const queryBuilder = sessionsRepository
      .createQueryBuilder('session')
      .where('session.post_id = :postId', { postId: session.postId })
      .andWhere('session.listen_counted_at IS NOT NULL')
      .andWhere('session.listen_counted_at > :cooldownBoundary', { cooldownBoundary })
      .andWhere('session.post_listen_session_id != :sessionId', {
        sessionId: session.postListenSessionId,
      });

    if (session.userId !== null) {
      queryBuilder.andWhere('session.user_id = :userId', { userId: session.userId });
    } else {
      queryBuilder
        .andWhere('session.user_id IS NULL')
        .andWhere('session.guest_session_id = :guestSessionId', {
          guestSessionId: session.guestSessionId,
        });
    }

    return (await queryBuilder.getCount()) > 0;
  }

  private async hasCountedAnonymousFingerprint(
    sessionsRepository: Repository<PostListenSession>,
    session: PostListenSession,
  ): Promise<boolean> {
    if (session.userId !== null || !session.fingerprintHash) {
      return false;
    }

    const count = await sessionsRepository
      .createQueryBuilder('session')
      .where('session.post_id = :postId', { postId: session.postId })
      .andWhere('session.user_id IS NULL')
      .andWhere('session.fingerprint_hash = :fingerprintHash', {
        fingerprintHash: session.fingerprintHash,
      })
      .andWhere('session.listen_counted_at IS NOT NULL')
      .andWhere('session.post_listen_session_id != :sessionId', {
        sessionId: session.postListenSessionId,
      })
      .getCount();

    return count > 0;
  }

  private isNullableInteger(value: unknown): value is number | null {
    return value === null || Number.isInteger(value);
  }

  private isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
  }
}
