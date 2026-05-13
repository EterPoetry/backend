import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post as HttpPost,
  Query,
  Req,
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
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CommentAuthorResponse,
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
import { GetPopularPostsQueryDto } from './dto/get-popular-posts-query.dto';
import { StartPostListenDto } from './dto/start-post-listen.dto';
import { UpdatePostListenProgressDto } from './dto/update-post-listen-progress.dto';
import { UpdatePostTextSynchronizationDto } from './dto/update-post-text-synchronization.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import {
  CategoryResponse,
  EndPostListenResponse,
  PostsService,
  PostResponse,
  PaginatedPostsResponse,
  PostAuthorProfileResponse,
  StartPostListenResponse,
  PostTextSynchronizationItemResponse,
  UpdatePostListenProgressResponse,
} from './posts.service';
import { PostAudioProcessingQueueService } from './post-audio-processing-queue.service';
import { UploadedPostAudio } from './post-audio-storage.service';

const { memoryStorage } = require('multer');

interface RequestWithUser extends Request {
  user: { userId: number; email?: string };
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

class PostResponseDto implements PostResponse {
  @ApiProperty({
    type: () => PostAuthorProfileResponseDto,
  })
  author: PostAuthorProfileResponseDto;

  @ApiProperty()
  postId: number;

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

  @ApiPropertyOptional({ nullable: true })
  originAuthorName: string | null;

  @ApiPropertyOptional({ type: [PostTextSynchronizationItemResponseDto] })
  textSynchronization?: PostTextSynchronizationItemResponseDto[];

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
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly commentsService: CommentsService,
    private readonly postAudioProcessingQueueService: PostAudioProcessingQueueService,
  ) {}

  @Get('me')
  async getMyPosts(
    @Req() req: RequestWithUser,
    @Query() query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    return this.postsService.getMyPosts(req.user.userId, query);
  }

  @Get('categories')
  async getCategories(@Query() query: GetCategoriesQueryDto): Promise<CategoryResponseDto[]> {
    return this.postsService.getCategories(query);
  }

  @Get('popular')
  async getPopularPosts(
    @Query() query: GetPopularPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    return this.postsService.getPopularPosts(query);
  }

  @Get(':postId')
  async getPostDetails(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<PostResponseDto> {
    return this.postsService.getPostDetails(postId, req.user.userId);
  }

  @Get(':postId/comments')
  async getPostComments(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Query() query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponseDto> {
    return this.commentsService.getPostComments(postId, req.user.userId, query);
  }

  @HttpPost(':postId/listen/start')
  async startPostListen(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: StartPostListenDto,
  ): Promise<StartPostListenResponseDto> {
    return this.postsService.startPostListen(postId, req.user.userId, dto.sessionId);
  }

  @HttpPost(':postId/listen/progress')
  async updatePostListenProgress(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostListenProgressDto,
  ): Promise<UpdatePostListenProgressResponseDto> {
    return this.postsService.updatePostListenProgress(
      postId,
      req.user.userId,
      dto.token,
      dto.positionMs,
    );
  }

  @HttpPost(':postId/listen/end')
  async endPostListen(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: EndPostListenDto,
  ): Promise<EndPostListenResponseDto> {
    return this.postsService.endPostListen(
      postId,
      req.user.userId,
      dto.token,
      dto.positionMs,
      dto.sessionId,
    );
  }

  @Get('comments/:commentId/replies')
  async getCommentReplies(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Query() query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponseDto> {
    return this.commentsService.getCommentReplies(commentId, req.user.userId, query);
  }

  @HttpPost(':postId/comments')
  async createComment(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.commentsService.createComment(postId, req.user.userId, dto);
  }

  @HttpPost('comments/:commentId/like')
  async likeComment(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<{ ok: true }> {
    return this.commentsService.likeComment(commentId, req.user.userId);
  }

  @Delete('comments/:commentId/like')
  async unlikeComment(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<{ ok: true }> {
    return this.commentsService.unlikeComment(commentId, req.user.userId);
  }

  @Delete('comments/:commentId')
  async deleteComment(
    @Req() req: RequestWithUser,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<{ ok: true }> {
    return this.commentsService.deleteComment(commentId, req.user.userId);
  }

  @Patch(':postId')
  async updatePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePost(postId, req.user.userId, dto);
  }

  @Patch(':postId/text-synchronization')
  async updatePostTextSynchronization(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostTextSynchronizationDto,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePostTextSynchronization(
      postId,
      req.user.userId,
      dto.textSynchronization,
    );
  }

  @Patch(':postId/audio')
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

    const post = await this.postsService.replacePostAudio(postId, req.user.userId, audio);
    void this.postAudioProcessingQueueService.enqueueExistingPendingJobs();
    return post;
  }

  @Delete(':postId')
  async deletePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<{ ok: true }> {
    await this.postsService.deletePost(postId, req.user.userId);
    return { ok: true };
  }

  @HttpPost()
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

    const post = await this.postsService.createEmptyPost(req.user.userId, audio);
    void this.postAudioProcessingQueueService.enqueueExistingPendingJobs();
    return post;
  }
}
