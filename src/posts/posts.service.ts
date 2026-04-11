import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { PostAudioProcessingJobStatus } from '../common/enums/post-audio-processing-job-status.enum';
import { Post } from './entities/post.entity';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
import { PostAudioStorageService, UploadedPostAudio } from './post-audio-storage.service';
import { PostAudioTranscodingService } from './post-audio-transcoding.service';
import { GetMyPostsQueryDto, MyPostsSortBy, SortOrder } from './dto/get-my-posts-query.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Category } from '../categories/entities/category.entity';
import { PostCategory } from '../categories/entities/post-category.entity';
import { GetCategoriesQueryDto } from './dto/get-categories-query.dto';

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
  status: PostStatus;
  listens: number;
  originAuthorName: string | null;
  categories: CategoryResponse[];
  authorId: number;
  createdAt: Date;
  updatedAt: Date;
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
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(PostCategory)
    private readonly postCategoriesRepository: Repository<PostCategory>,
    private readonly postAudioStorageService: PostAudioStorageService,
    private readonly postAudioTranscodingService: PostAudioTranscodingService,
  ) {}

  async createEmptyPost(authorId: number, audio: UploadedPostAudio): Promise<PostResponse> {
    await this.postAudioTranscodingService.ensureDurationWithinLimit(audio);

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

      return this.buildPostResponse(savedPost);
    } catch (error) {
      await this.postAudioStorageService.deleteAudio(sourceAudioFileName);
      throw error;
    }
  }

  async getPostById(postId: number): Promise<Post | null> {
    return this.postsRepository.findOne({
      where: { postId },
      relations: {
        postCategories: {
          category: true,
        },
      },
    });
  }

  async getPostDetails(postId: number, requesterUserId: number): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);
    return this.buildPostResponse(post);
  }

  async getMyPosts(
    authorId: number,
    query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponse> {
    const queryBuilder = this.postsRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.postCategories', 'postCategory')
      .leftJoinAndSelect('postCategory.category', 'category')
      .where('post.author_id = :authorId', { authorId });

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

    queryBuilder.orderBy(sortColumn, sortDirection).addOrderBy('post.post_id', 'DESC');
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
      await this.syncPostCategories(post.postId, dto.categoryIds);
    }

    if (post.status === PostStatus.PROCESSING) {
      throw new ForbiddenException('Post is still processing and cannot be edited.');
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.postsRepository.update(post.postId, updatePayload);
    }
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

  async replacePostAudio(
    postId: number,
    requesterUserId: number,
    audio: UploadedPostAudio,
  ): Promise<PostResponse> {
    const post = await this.requireOwnedPost(postId, requesterUserId);

    if (post.status !== PostStatus.DRAFT) {
      throw new ForbiddenException('Audio can only be replaced for draft posts.');
    }

    await this.postAudioTranscodingService.ensureDurationWithinLimit(audio);
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
          status: PostStatus.PROCESSING,
        });

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
      status: post.status,
      listens: post.listens,
      originAuthorName: post.originAuthorName,
      categories: (post.postCategories ?? [])
        .map((postCategory) => postCategory.category)
        .filter((category): category is Category => Boolean(category))
        .map((category) => this.buildCategoryResponse(category)),
      authorId: post.authorId,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  private mapSortByToColumn(sortBy: MyPostsSortBy): string {
    switch (sortBy) {
      case MyPostsSortBy.UPDATED_AT:
        return 'post.updated_at';
      case MyPostsSortBy.TITLE:
        return 'post.title';
      case MyPostsSortBy.LISTENS:
        return 'post.listens';
      case MyPostsSortBy.CREATED_AT:
      default:
        return 'post.created_at';
    }
  }

  private async requireOwnedPost(postId: number, requesterUserId: number): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: { postId },
      relations: {
        postCategories: {
          category: true,
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    if (post.authorId !== requesterUserId) {
      throw new ForbiddenException('You do not have access to this post.');
    }

    return post;
  }

  private async syncPostCategories(postId: number, categoryIds: number[]): Promise<void> {
    const normalizedCategoryIds = [...new Set(categoryIds)];
    const categories = normalizedCategoryIds.length
      ? await this.categoriesRepository.find({
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

    await this.postCategoriesRepository.delete({ postId });

    if (!normalizedCategoryIds.length) {
      return;
    }

    await this.postCategoriesRepository.save(
      normalizedCategoryIds.map((categoryId) =>
        this.postCategoriesRepository.create({
          postId,
          categoryId,
        }),
      ),
    );
  }

  private buildCategoryResponse(category: Category): CategoryResponse {
    return {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      categoryDescription: category.categoryDescription,
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
}
