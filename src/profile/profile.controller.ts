import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post as HttpPost,
  Param,
  Patch,
  ParseIntPipe,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetMyPostsQueryDto } from '../posts/dto/get-my-posts-query.dto';
import {
  CategoryResponse,
  PaginatedPostsResponse,
  PostAuthorProfileResponse,
  PostResponse,
  PostTextSynchronizationItemResponse,
} from '../posts/posts.service';
import { PostStatus } from '../common/enums/post-status.enum';
import { UploadedAvatar } from './avatar-storage.service';
import { GetProfileFollowListQueryDto } from './dto/get-profile-follow-list-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ActiveViolationResponse,
  ActiveViolationTargetPostResponse,
  PaginatedProfileFollowListResponse,
  ProfileResponse,
  ProfileFollowListItemResponse,
  PublicProfileResponse,
  ProfileService,
} from './profile.service';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';

const { memoryStorage } = require('multer');

interface RequestWithUser extends Request {
  user: { userId: number; email?: string };
}

class ProfileResponseDto implements ProfileResponse {
  @ApiProperty()
  userId: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ nullable: true })
  photo: string | null;

  @ApiProperty()
  isEmailVerified: boolean;

  @ApiProperty()
  isPremium: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  followersCount: number;

  @ApiProperty()
  followingCount: number;

  @ApiProperty()
  postsCount: number;

  @ApiProperty()
  currentViolationsCount: number;

  @ApiProperty()
  maxViolationsBeforeBlock: number;
}

class PublicProfileResponseDto implements PublicProfileResponse {
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

  @ApiProperty()
  isSubscribed: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  followersCount: number;

  @ApiProperty()
  followingCount: number;

  @ApiProperty()
  postsCount: number;
}

class CategoryResponseDto implements CategoryResponse {
  @ApiProperty()
  categoryId: number;

  @ApiProperty()
  categoryName: string;

  @ApiPropertyOptional({ nullable: true })
  categoryDescription: string | null;
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

  @ApiProperty({ type: [PostTextSynchronizationItemResponseDto] })
  textSynchronization: PostTextSynchronizationItemResponseDto[];

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

class ActiveViolationTargetPostDto implements ActiveViolationTargetPostResponse {
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

  @ApiProperty()
  createdAt: Date;
}

class ActiveViolationResponseDto implements ActiveViolationResponse {
  @ApiProperty()
  complaintId: number;

  @ApiProperty()
  complaintReason: string;

  @ApiProperty({ enum: ComplaintStatus, enumName: 'ComplaintStatus' })
  status: ComplaintStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ type: ActiveViolationTargetPostDto })
  targetPost: ActiveViolationTargetPostDto;
}

class ProfileFollowListItemResponseDto implements ProfileFollowListItemResponse {
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

  @ApiProperty()
  isSubscribed: boolean;
}

class PaginatedProfileFollowListResponseDto implements PaginatedProfileFollowListResponse {
  @ApiProperty({ type: [ProfileFollowListItemResponseDto] })
  items: ProfileFollowListItemResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  limit: number;

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

@Controller('profile')
@ApiTags('Profile')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  async getMyProfile(@Req() req: RequestWithUser): Promise<ProfileResponseDto> {
    return this.profileService.getMyProfile(req.user.userId);
  }

  @Get('me/violations')
  async getMyActiveViolations(@Req() req: RequestWithUser): Promise<ActiveViolationResponseDto[]> {
    return this.profileService.getMyActiveViolations(req.user.userId);
  }

  @Get('me/followers')
  async getMyFollowers(
    @Req() req: RequestWithUser,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getMyFollowers(req.user.userId, query);
  }

  @Get('me/following')
  async getMyFollowing(
    @Req() req: RequestWithUser,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getMyFollowing(req.user.userId, query);
  }

  @Patch('me')
  async updateMyProfile(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateMyProfile(req.user.userId, dto);
  }

  @Patch('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['avatar'],
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async updateMyAvatar(
    @Req() req: RequestWithUser,
    @UploadedFile() avatar?: UploadedAvatar,
  ): Promise<ProfileResponseDto> {
    if (!avatar) {
      throw new BadRequestException('Avatar file is required.');
    }

    return this.profileService.updateMyAvatar(req.user.userId, avatar);
  }

  @HttpPost(':userId/follow')
  async followUser(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.followUser(userId, req.user.userId);
  }

  @Delete(':userId/follow')
  async unfollowUser(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.unfollowUser(userId, req.user.userId);
  }

  @Get(':userId/posts')
  async getProfilePublishedPosts(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    return this.profileService.getProfilePublishedPosts(userId, query);
  }

  @Get(':userId')
  async getProfileById(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.getProfileById(userId, req.user.userId);
  }
}
