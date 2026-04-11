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
import { PostStatus } from '../common/enums/post-status.enum';
import { GetCategoriesQueryDto } from './dto/get-categories-query.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts-query.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import {
  CategoryResponse,
  PostsService,
  PostResponse,
  PaginatedPostsResponse,
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

class PostResponseDto implements PostResponse {
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

  @ApiProperty()
  listens: number;

  @ApiPropertyOptional({ nullable: true })
  originAuthorName: string | null;

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

@Controller('posts')
@ApiTags('Posts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
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

  @Get(':postId')
  async getPostDetails(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<PostResponseDto> {
    return this.postsService.getPostDetails(postId, req.user.userId);
  }

  @Patch(':postId')
  async updatePost(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePost(postId, req.user.userId, dto);
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
