import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post as HttpPost,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { type CookieOptions, Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CommentAuthorResponse,
  CommentLikeMutationResponse,
  CommentResponse,
  CommentsService,
  PaginatedCommentsResponse,
} from '../comments/comments.service';
import { CreateCommentDto } from '../comments/dto/create-comment.dto';
import { GetPostCommentsQueryDto } from '../comments/dto/get-post-comments-query.dto';
import { PostStatus } from '../common/enums/post-status.enum';
import { GetCategoriesQueryDto } from './dto/get-categories-query.dto';
import { EndPostListenDto } from './dto/end-post-listen.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts-query.dto';
import { GetFeedPostsQueryDto } from './dto/get-feed-posts-query.dto';
import { GetLikedPostsQueryDto } from './dto/get-liked-posts-query.dto';
import { GetPublishedPostsSearchQueryDto } from './dto/get-published-posts-search-query.dto';
import { GetPopularPostsQueryDto } from './dto/get-popular-posts-query.dto';
import { StartPostListenDto } from './dto/start-post-listen.dto';
import { UpdatePostListenProgressDto } from './dto/update-post-listen-progress.dto';
import { UpdatePostTextSynchronizationDto } from './dto/update-post-text-synchronization.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import {
  CategoryResponse,
  EndPostListenResponse,
  FeedPostsResponse,
  PaginatedPostsResponse,
  PopularPostsResponse,
  PostAuthorProfileResponse,
  PostLikeMutationResponse,
  PostResponse,
  PostsService,
  StartPostListenResponse,
  PostTextSynchronizationItemResponse,
  UpdatePostListenProgressResponse,
} from './posts.service';
import { PostAudioProcessingQueueService } from './post-audio-processing-queue.service';
import { UploadedPostAudio } from './post-audio-storage.service';
import { AudioAnalysisV1Dto } from './audio-analysis.types';

const { memoryStorage } = require('multer');
const GUEST_SESSION_COOKIE_NAME = 'guestSessionId';
const GUEST_SESSION_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

interface RequestWithUser extends Request {
  user?: { userId: number; email?: string };
}

class CategoryResponseDto implements CategoryResponse {
  @ApiProperty()
  categoryId: number;

  @ApiProperty()
  categoryName: string;

  @ApiPropertyOptional({ nullable: true })
  categoryDescription: string | null;
}

class CommentAuthorResponseDto implements CommentAuthorResponse {
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

class CommentResponseDto implements CommentResponse {
  @ApiProperty()
  commentId: number;

  @ApiProperty()
  postId: number;

  @ApiProperty()
  commentText: string;

  @ApiPropertyOptional({ nullable: true })
  replyToCommentId: number | null;

  @ApiProperty()
  repliesCount: number;

  @ApiProperty()
  likesCount: number;

  @ApiProperty()
  isLiked: boolean;

  @ApiProperty()
  isLikedByAuthor: boolean;

  @ApiProperty({ type: () => CommentAuthorResponseDto })
  author: CommentAuthorResponseDto;
}

class PaginatedCommentsResponseDto implements PaginatedCommentsResponse {
  @ApiProperty({ type: [CommentResponseDto] })
  items: CommentResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  limit: number;

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

class LikeMutationResponseDto implements PostLikeMutationResponse, CommentLikeMutationResponse {
  @ApiProperty()
  ok: true;

  @ApiProperty()
  likesCount: number;
}

class PostAuthorProfileResponseDto implements PostAuthorProfileResponse {
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

class PostTextSynchronizationItemResponseDto implements PostTextSynchronizationItemResponse {
  @ApiProperty()
  lineIndex: number;

  @ApiProperty()
  audioStartMomentMs: number;
}

class AudioAnalysisResponseDto implements AudioAnalysisV1Dto {
  @ApiProperty({ example: 1 })
  version: 1;

  @ApiProperty()
  durationMs: number;

  @ApiProperty()
  frameMs: number;

  @ApiProperty({ type: [String], example: ['energy', 'peak', 'low', 'mid', 'high', 'zcr'] })
  features: Array<'energy' | 'peak' | 'low' | 'mid' | 'high' | 'zcr'>;

  @ApiProperty()
  frames: string;

  @ApiProperty()
  waveform: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
  })
  accents: Array<[number, number]>;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
  })
  silences: Array<[number, number]>;
}

class PostResponseDto implements PostResponse {
  @ApiProperty({
    type: () => PostAuthorProfileResponseDto,
  })
  author: PostAuthorProfileResponseDto;

  @ApiProperty()
  postId: number;

  @ApiProperty()
  slug: string;

  @ApiPropertyOptional({ nullable: true })
  title: string | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  text: string | null;

  @ApiPropertyOptional({ nullable: true })
  audioFileName: string | null;

  @ApiPropertyOptional({ nullable: true })
  audioFileUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  audioDurationSeconds: number | null;

  @ApiProperty()
  listens: number;

  @ApiProperty()
  likesCount: number;

  @ApiProperty()
  commentsCount: number;

  @ApiProperty()
  isLiked: boolean;

  @ApiPropertyOptional({ nullable: true })
  originAuthorName: string | null;

  @ApiPropertyOptional({ type: [PostTextSynchronizationItemResponseDto] })
  textSynchronization?: PostTextSynchronizationItemResponseDto[];

  @ApiPropertyOptional({ type: () => AudioAnalysisResponseDto, nullable: true })
  audioAnalysis?: AudioAnalysisResponseDto | null;

  @ApiProperty({ type: [CategoryResponseDto] })
  categories: CategoryResponseDto[];

  @ApiProperty({ enum: PostStatus, enumName: 'PostStatus' })
  status: PostStatus;

  @ApiProperty()
  authorId: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

class PaginatedPostsResponseDto implements PaginatedPostsResponse {
  @ApiProperty({ type: [PostResponseDto] })
  items: PostResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  offset: number;
}

class FeedPostsResponseDto implements FeedPostsResponse {
  @ApiProperty({ type: [PostResponseDto] })
  items: PostResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

class PopularPostsResponseDto implements PopularPostsResponse {
  @ApiProperty({ type: [PostResponseDto] })
  items: PostResponseDto[];

  @ApiProperty()
  snapshotId: number;

  @ApiProperty()
  snapshotGeneratedAt: Date;

  @ApiProperty()
  total: number;

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

class StartPostListenResponseDto implements StartPostListenResponse {
  @ApiProperty()
  token: string;

  @ApiProperty()
  listenedMs: number;

  @ApiProperty()
  trackDurationMs: number;

  @ApiProperty()
  isSuspicious: boolean;
}

class UpdatePostListenProgressResponseDto implements UpdatePostListenProgressResponse {
  @ApiProperty()
  listenedMs: number;

  @ApiProperty()
  isSuspicious: boolean;

  @ApiPropertyOptional({ nullable: true })
  suspiciousReason: string | null;
}

class EndPostListenResponseDto
  extends UpdatePostListenProgressResponseDto
  implements EndPostListenResponse
{
  @ApiProperty()
  counted: boolean;

  @ApiPropertyOptional({ nullable: true })
  countedAt: Date | null;

  @ApiProperty()
  thresholdReached: boolean;
}

@Controller('posts')
@ApiTags('Posts')
@ApiBearerAuth()
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly commentsService: CommentsService,
    private readonly postAudioProcessingQueueService: PostAudioProcessingQueueService,
  ) {}

  private requireUser(req: RequestWithUser): { userId: number; email?: string } {
    if (!req.user) {
      throw new ForbiddenException('Authentication required.');
    }

    return req.user;
  }

  private buildListenRequestContext(
    req: RequestWithUser,
    guestSessionId: string | null,
  ): {
    requesterUserId: number | null;
    guestSessionId: string | null;
    fingerprintHashSource: string | null;
  } {
    return {
      requesterUserId: req.user?.userId ?? null,
      guestSessionId,
      fingerprintHashSource: this.getFingerprintHashSource(req),
    };
  }

  private getFingerprintHashSource(req: Request): string | null {
    const clientIp = this.getClientIp(req);
    const userAgent = req.get('user-agent')?.trim() || null;
    const acceptLanguage = req.get('accept-language')?.trim() || null;
    const fingerprintParts = [clientIp, userAgent, acceptLanguage].filter(
      (value): value is string => Boolean(value),
    );

    return fingerprintParts.length ? fingerprintParts.join('|') : null;
  }

  private getClientIp(req: Request): string | null {
    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0];
    const clientIp = forwardedIp?.trim() || req.ip || req.socket.remoteAddress;
    return clientIp ? clientIp.slice(0, 64) : null;
  }

  private ensureGuestSessionId(req: Request, res: Response): string {
    const existingGuestSessionId = this.getGuestSessionId(req);
    if (existingGuestSessionId) {
      return existingGuestSessionId;
    }

    const guestSessionId = randomUUID();
    res.cookie(GUEST_SESSION_COOKIE_NAME, guestSessionId, {
      ...this.getGuestSessionCookieBaseOptions(),
      maxAge: GUEST_SESSION_COOKIE_MAX_AGE_MS,
    });
    return guestSessionId;
  }

  private getGuestSessionId(req: Request): string | null {
    const guestSessionId = req.cookies?.[GUEST_SESSION_COOKIE_NAME];

    if (typeof guestSessionId !== 'string' || !guestSessionId.trim()) {
      return null;
    }

    return guestSessionId.trim().slice(0, 120);
  }

  private getGuestSessionCookieBaseOptions(): CookieOptions {
    const secure =
      this.getBooleanEnv('GUEST_SESSION_COOKIE_SECURE') ?? process.env.NODE_ENV === 'production';
    const sameSite = this.getCookieSameSite('GUEST_SESSION_COOKIE_SAME_SITE', secure);
    const domain = process.env.GUEST_SESSION_COOKIE_DOMAIN?.trim();

    return {
      httpOnly: true,
      secure,
      sameSite,
      ...(domain ? { domain } : {}),
      path: '/',
    };
  }

  private getCookieSameSite(name: string, secure: boolean): CookieOptions['sameSite'] {
    const configuredValue = process.env[name]?.trim().toLowerCase();

    if (!configuredValue) {
      return secure ? 'none' : 'lax';
    }

    if (
      configuredValue === 'lax' ||
      configuredValue === 'strict' ||
      configuredValue === 'none'
    ) {
      return configuredValue;
    }

    throw new ForbiddenException(`${name} must be one of: lax, strict, none.`);
  }

  private getBooleanEnv(name: string): boolean | null {
    const value = process.env[name]?.trim().toLowerCase();

    if (!value) {
      return null;
    }

    if (value === 'true' || value === '1' || value === 'yes') {
      return true;
    }

    if (value === 'false' || value === '0' || value === 'no') {
      return false;
    }

    throw new ForbiddenException(`${name} must be a boolean value.`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyPosts(
    @Req() req: RequestWithUser,
    @Query() query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    const userId = this.requireUser(req).userId;
    return this.postsService.getMyPosts(userId, query, userId);
  }

  @Get('feed')
  @UseGuards(JwtAuthGuard)
  async getFeedPosts(
    @Req() req: RequestWithUser,
    @Query() query: GetFeedPostsQueryDto,
  ): Promise<FeedPostsResponseDto> {
    const userId = this.requireUser(req).userId;
    return this.postsService.getFeedPosts(userId, query);
  }

  @Get('liked')
  @UseGuards(JwtAuthGuard)
  async getLikedPosts(
    @Req() req: RequestWithUser,
    @Query() query: GetLikedPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    const userId = this.requireUser(req).userId;
    return this.postsService.getLikedPosts(userId, query);
  }

  @Get('categories')
  @UseGuards(OptionalJwtAuthGuard)
  async getCategories(@Query() query: GetCategoriesQueryDto): Promise<CategoryResponseDto[]> {
    return this.postsService.getCategories(query);
  }

  @Get('popular')
  @UseGuards(OptionalJwtAuthGuard)
  async getPopularPosts(
    @Req() req: RequestWithUser,
    @Query() query: GetPopularPostsQueryDto,
  ): Promise<PopularPostsResponseDto> {
    return this.postsService.getPopularPosts(query, req.user?.userId ?? null);
  }

  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  async searchPublishedPosts(
    @Req() req: RequestWithUser,
    @Query() query: GetPublishedPostsSearchQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    return this.postsService.searchPublishedPosts(query, req.user?.userId ?? null);
  }

  @Get(':postId')
  @UseGuards(OptionalJwtAuthGuard)
  async getPostDetails(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<PostResponseDto> {
    return this.postsService.getPostDetails(postId, req.user?.userId ?? null);
  }

  @Get(':postId/comments')
  @UseGuards(OptionalJwtAuthGuard)
  async getPostComments(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Query() query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponseDto> {
    return this.commentsService.getPostComments(postId, req.user?.userId ?? null, query);
  }

  @HttpPost(':postId/listen/start')
  @UseGuards(OptionalJwtAuthGuard)
  async startPostListen(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: StartPostListenDto,
  ): Promise<StartPostListenResponseDto> {
    const guestSessionId = req.user ? this.getGuestSessionId(req) : this.ensureGuestSessionId(req, res);
    return this.postsService.startPostListen(
      postId,
      this.buildListenRequestContext(req, guestSessionId),
      dto.sessionId,
    );
  }

  @HttpPost(':postId/listen/progress')
  @UseGuards(OptionalJwtAuthGuard)
  async updatePostListenProgress(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostListenProgressDto,
  ): Promise<UpdatePostListenProgressResponseDto> {
    return this.postsService.updatePostListenProgress(
      postId,
      this.buildListenRequestContext(req, this.getGuestSessionId(req)),
      dto.token,
      dto.positionMs,
    );
  }

  @HttpPost(':postId/listen/end')
  @UseGuards(OptionalJwtAuthGuard)
  async endPostListen(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: EndPostListenDto,
  ): Promise<EndPostListenResponseDto> {
    return this.postsService.endPostListen(
      postId,
      this.buildListenRequestContext(req, this.getGuestSessionId(req)),
      dto.token,
      dto.positionMs,
      dto.sessionId,
    );
  }

  @Get('comments/:commentId/replies')
  @UseGuards(OptionalJwtAuthGuard)
  async getCommentReplies(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Query() query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponseDto> {
    return this.commentsService.getCommentReplies(commentId, req.user?.userId ?? null, query);
  }

  @HttpPost(':postId/comments')
  @UseGuards(JwtAuthGuard)
  async createComment(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.commentsService.createComment(postId, this.requireUser(req).userId, dto);
  }

  @HttpPost(':postId/like')
  @UseGuards(JwtAuthGuard)
  async likePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<LikeMutationResponseDto> {
    return this.postsService.likePost(postId, this.requireUser(req).userId);
  }

  @Delete(':postId/like')
  @UseGuards(JwtAuthGuard)
  async unlikePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<LikeMutationResponseDto> {
    return this.postsService.unlikePost(postId, this.requireUser(req).userId);
  }

  @HttpPost('comments/:commentId/like')
  @UseGuards(JwtAuthGuard)
  async likeComment(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<LikeMutationResponseDto> {
    return this.commentsService.likeComment(commentId, this.requireUser(req).userId);
  }

  @Delete('comments/:commentId/like')
  @UseGuards(JwtAuthGuard)
  async unlikeComment(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<LikeMutationResponseDto> {
    return this.commentsService.unlikeComment(commentId, this.requireUser(req).userId);
  }

  @Delete('comments/:commentId')
  @UseGuards(JwtAuthGuard)
  async deleteComment(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<{ ok: true }> {
    return this.commentsService.deleteComment(commentId, this.requireUser(req).userId);
  }

  @Patch(':postId')
  @UseGuards(JwtAuthGuard)
  async updatePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePost(postId, this.requireUser(req).userId, dto);
  }

  @Patch(':postId/text-synchronization')
  @UseGuards(JwtAuthGuard)
  async updatePostTextSynchronization(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostTextSynchronizationDto,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePostTextSynchronization(
      postId,
      this.requireUser(req).userId,
      dto.textSynchronization,
    );
  }

  @Patch(':postId/audio')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: {
        fileSize: 80 * 1024 * 1024,
      },
    }),
  )
  async updatePostAudio(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @UploadedFile() audio?: UploadedPostAudio,
  ): Promise<PostResponseDto> {
    if (!audio) {
      throw new BadRequestException('Audio file is required.');
    }

    const post = await this.postsService.replacePostAudio(
      postId,
      this.requireUser(req).userId,
      audio,
    );
    void this.postAudioProcessingQueueService.enqueueExistingPendingJobs();
    return post;
  }

  @Delete(':postId')
  @UseGuards(JwtAuthGuard)
  async deletePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<{ ok: true }> {
    await this.postsService.deletePost(postId, this.requireUser(req).userId);
    return { ok: true };
  }

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: {
        fileSize: 80 * 1024 * 1024,
      },
    }),
  )
  async createPost(
    @Req() req: RequestWithUser,
    @UploadedFile() audio?: UploadedPostAudio,
  ): Promise<PostResponseDto> {
    if (!audio) {
      throw new BadRequestException('Audio file is required.');
    }

    const post = await this.postsService.createEmptyPost(this.requireUser(req).userId, audio);
    void this.postAudioProcessingQueueService.enqueueExistingPendingJobs();
    return post;
  }
}
