import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { PostAudioProcessingJobStatus } from '../common/enums/post-audio-processing-job-status.enum';
import { Post } from './entities/post.entity';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
import { PostListenSession } from './entities/post-listen-session.entity';
import { PostTextPart } from './entities/post-text-part.entity';
import { PostAudioStorageService, UploadedPostAudio } from './post-audio-storage.service';
import { PostAudioTranscodingService } from './post-audio-transcoding.service';
import {
  GetMyPostsQueryDto,
  MyPostsSortBy,
  SortOrder,
} from './dto/get-my-posts-query.dto';
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
  originAuthorName: string | null;
  textSynchronization: PostTextSynchronizationItemResponse[];
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

export interface StartPostListenResponse {
  token: string;
  listenedMs: number;
  trackDurationMs: number;
  isSuspicious: boolean;
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

interface ListenSessionTokenPayload {
  sessionId: number;
  postId: number;
  userId: number;
  clientSessionId: string;
}

const LISTEN_COMPLETION_RATIO = 0.8;
const LISTEN_COOLDOWN_HOURS = 12;
const LISTEN_PROGRESS_MAX_SPEED_RATIO = 1.25;
const LISTEN_PROGRESS_TIME_SKEW_MS = 1500;
const LISTEN_POSITION_OVERSHOOT_MS = 3000;

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
    private readonly postAudioStorageService: PostAudioStorageService,
    private readonly postAudioTranscodingService: PostAudioTranscodingService,
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
            authorId,
          }),
        );

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

  async getPostById(postId: number): Promise<Post | null> {
    return this.createPostDetailsQueryBuilder()
      .where('post.post_id = :postId', { postId })
      .getOne();
  }

  async getPostDetails(postId: number, requesterUserId: number): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);
    return this.buildPostResponse(post);
  }

  async getMyPosts(
    authorId: number,
    query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponse> {
    return this.getPostsByAuthor(authorId, query);
  }

  async getPublishedPostsByAuthor(
    authorId: number,
    query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponse> {
    return this.getPostsByAuthor(authorId, query, PostStatus.PUBLISHED);
  }

  async startPostListen(
    postId: number,
    requesterUserId: number,
    clientSessionId: string,
  ): Promise<StartPostListenResponse> {
    const post = await this.getPostForListening(postId, requesterUserId);
    const trackDurationMs = this.getTrackDurationMs(post.audioDurationSeconds);
    const existingSession = await this.postListenSessionsRepository.findOne({
      where: {
        postId,
        userId: requesterUserId,
        clientSessionId,
      },
    });

    if (existingSession) {
      return {
        token: this.signListenSessionToken(existingSession),
        listenedMs: existingSession.listenedMs,
        trackDurationMs: existingSession.trackDurationMs,
        isSuspicious: existingSession.isSuspicious,
      };
    }

    const now = new Date();
    const session = await this.postListenSessionsRepository.save(
      this.postListenSessionsRepository.create({
        postId: post.postId,
        userId: requesterUserId,
        clientSessionId,
        trackDurationMs,
        listenedMs: 0,
        maxPositionMs: 0,
        lastPositionMs: 0,
        lastProgressAt: now,
        endedAt: null,
        listenCountedAt: null,
        isSuspicious: false,
        suspiciousReason: null,
      }),
    );

    return {
      token: this.signListenSessionToken(session),
      listenedMs: session.listenedMs,
      trackDurationMs: session.trackDurationMs,
      isSuspicious: session.isSuspicious,
    };
  }

  async updatePostListenProgress(
    postId: number,
    requesterUserId: number,
    token: string,
    positionMs: number,
  ): Promise<UpdatePostListenProgressResponse> {
    const tokenPayload = this.verifyListenSessionToken(token);
    const session = await this.getListenSessionForUpdate(postId, requesterUserId, tokenPayload);

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
    requesterUserId: number,
    token: string,
    positionMs: number,
    clientSessionId?: string,
  ): Promise<EndPostListenResponse> {
    const tokenPayload = this.verifyListenSessionToken(token);
    if (clientSessionId && clientSessionId !== tokenPayload.clientSessionId) {
      throw new BadRequestException('Session id does not match the listen token.');
    }

    const session = await this.getListenSessionForUpdate(postId, requesterUserId, tokenPayload);
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
        post.authorId !== lockedSession.userId &&
        post.status === PostStatus.PUBLISHED
      ) {
        await manager.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
          lockedSession.userId,
          lockedSession.postId,
        ]);

        const cooldownBoundary = this.getListenCooldownBoundary(now);
        const recentCount = await sessionsRepository
          .createQueryBuilder('session')
          .where('session.post_id = :postId', { postId: lockedSession.postId })
          .andWhere('session.user_id = :userId', { userId: lockedSession.userId })
          .andWhere('session.listen_counted_at IS NOT NULL')
          .andWhere('session.listen_counted_at > :cooldownBoundary', { cooldownBoundary })
          .andWhere('session.post_listen_session_id != :sessionId', {
            sessionId: lockedSession.postListenSessionId,
          })
          .getCount();

        if (recentCount === 0) {
          countedAt = now;
          await postsRepository.increment({ postId: lockedSession.postId }, 'listens', 1);
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
    status?: PostStatus,
  ): Promise<PaginatedPostsResponse> {
    const queryBuilder = this.postsRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('author.subscription', 'authorSubscription')
      .leftJoinAndSelect('post.textParts', 'textPart')
      .leftJoinAndSelect('post.postCategories', 'postCategory')
      .leftJoinAndSelect('postCategory.category', 'category')
      .loadRelationCountAndMap('post.likesCount', 'post.postReactions', 'postReaction', (queryBuilder) =>
        queryBuilder.where('postReaction.reactionType = :reactionType', {
          reactionType: ReactionType.LIKE,
        }),
      )
      .loadRelationCountAndMap('post.commentsCount', 'post.comments')
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

    const sortColumn = this.mapSortByToColumn(query.sortBy);
    const sortDirection = query.sortOrder.toUpperCase() === SortOrder.ASC.toUpperCase() ? 'ASC' : 'DESC';
    const limit = query.limit;
    const offset = query.offset;

    queryBuilder.orderBy(sortColumn, sortDirection).addOrderBy('post.postId', 'DESC');
    queryBuilder.distinct(true);
    queryBuilder.skip(offset).take(limit);

    const [posts, total] = await queryBuilder.getManyAndCount();

    return {
      items: posts.map((post) => this.buildPostResponse(post)),
      total,
      offset,
    };
  }

  async markPostProcessingCompleted(
    post: Post,
    processedAudioFileName: string,
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

    await this.postsRepository.update(post.postId, {
      audioFileName: processedAudioFileName,
      sourceAudioFileName: null,
      status: nextStatus,
    });

    if (previousAudioFileName && previousAudioFileName !== processedAudioFileName) {
      await this.postAudioStorageService.deleteAudio(previousAudioFileName);
    }

    return previousSourceAudioFileName;
  }

  async updatePost(
    postId: number,
    requesterUserId: number,
    dto: UpdatePostDto,
  ): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);

    if (dto.title !== undefined) {
      post.title = dto.title;
    }

    if (dto.description !== undefined) {
      post.description = dto.description;
    }

    if (dto.text !== undefined) {
      post.text = dto.text;
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
      }

      if (dto.description !== undefined) {
        updatePayload.description = dto.description;
      }

      if (dto.text !== undefined) {
        updatePayload.text = dto.text;
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

      if (dto.text !== undefined) {
        await this.removeOutdatedTextSynchronization(manager, post.postId, dto.text);
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
        });
        await manager.getRepository(PostTextPart).delete({ postId: post.postId });

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

  buildPostResponse(post: Post): PostResponse {
    return {
      postId: post.postId,
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
      originAuthorName: post.originAuthorName,
      textSynchronization: (post.textParts ?? [])
        .slice()
        .sort((left, right) => left.lineIndex - right.lineIndex)
        .map((textPart) => ({
          lineIndex: textPart.lineIndex,
          audioStartMomentMs: textPart.audioStartMomentMs,
        })),
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

  private createPostDetailsQueryBuilder() {
    return this.postsRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('author.subscription', 'authorSubscription')
      .leftJoinAndSelect('post.textParts', 'textPart')
      .leftJoinAndSelect('post.postCategories', 'postCategory')
      .leftJoinAndSelect('postCategory.category', 'category')
      .loadRelationCountAndMap('post.likesCount', 'post.postReactions', 'postReaction', (queryBuilder) =>
        queryBuilder.where('postReaction.reactionType = :reactionType', {
          reactionType: ReactionType.LIKE,
        }),
      )
      .loadRelationCountAndMap('post.commentsCount', 'post.comments');
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

  private async getPostForListening(postId: number, requesterUserId: number): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: { postId },
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
      !Number.isInteger((parsedPayload as { userId?: unknown }).userId) ||
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
    requesterUserId: number,
    tokenPayload: ListenSessionTokenPayload,
  ): Promise<PostListenSession> {
    if (tokenPayload.postId !== postId || tokenPayload.userId !== requesterUserId) {
      throw new BadRequestException('Listen token does not match the request.');
    }

    const session = await this.postListenSessionsRepository.findOne({
      where: {
        postListenSessionId: tokenPayload.sessionId,
        postId,
        userId: requesterUserId,
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

    if (deltaPositionMs < 0) {
      return this.markListenSessionSuspicious(session, 'position_moved_backwards', now);
    }

    if (
      elapsedRealMs !== null &&
      deltaPositionMs >
        elapsedRealMs * LISTEN_PROGRESS_MAX_SPEED_RATIO + LISTEN_PROGRESS_TIME_SKEW_MS
    ) {
      return this.markListenSessionSuspicious(session, 'position_advanced_too_fast', now);
    }

    const listenedIncrementMs = Math.max(0, positionMs - session.maxPositionMs);
    await this.postListenSessionsRepository.update(session.postListenSessionId, {
      listenedMs: session.listenedMs + listenedIncrementMs,
      maxPositionMs: Math.max(session.maxPositionMs, positionMs),
      lastPositionMs: positionMs,
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

  private hasReachedListenThreshold(session: PostListenSession): boolean {
    return session.listenedMs >= Math.ceil(session.trackDurationMs * LISTEN_COMPLETION_RATIO);
  }

  private getListenCooldownBoundary(now: Date): Date {
    return new Date(now.getTime() - LISTEN_COOLDOWN_HOURS * 60 * 60 * 1000);
  }
}
