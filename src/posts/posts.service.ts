import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { PostAudioProcessingJobStatus } from '../common/enums/post-audio-processing-job-status.enum';
import { Post } from './entities/post.entity';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
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

@Injectable()
export class PostsService {
  constructor(
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
}
