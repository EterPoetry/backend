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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
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
  user?: { userId: number; email?: string };
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

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;

  @ApiPropertyOptional({ nullable: true })
  link: string | null;

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

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;

  @ApiPropertyOptional({ nullable: true })
  link: string | null;

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
@ApiBearerAuth()
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  private requireUser(req: RequestWithUser): { userId: number; email?: string } {
    if (!req.user) {
      throw new BadRequestException('Authentication required.');
    }

    return req.user;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(@Req() req: RequestWithUser): Promise<ProfileResponseDto> {
    return this.profileService.getMyProfile(this.requireUser(req).userId);
  }

  @Get('me/violations')
  @UseGuards(JwtAuthGuard)
  async getMyActiveViolations(@Req() req: RequestWithUser): Promise<ActiveViolationResponseDto[]> {
    return this.profileService.getMyActiveViolations(this.requireUser(req).userId);
  }

  @Get('me/followers')
  @UseGuards(JwtAuthGuard)
  async getMyFollowers(
    @Req() req: RequestWithUser,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getMyFollowers(this.requireUser(req).userId, query);
  }

  @Get('me/following')
  @UseGuards(JwtAuthGuard)
  async getMyFollowing(
    @Req() req: RequestWithUser,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getMyFollowing(this.requireUser(req).userId, query);
  }

  @Get('username/:username/followers')
  @UseGuards(JwtAuthGuard)
  async getProfileFollowers(
    @Req() req: RequestWithUser,
    @Param('username') username: string,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getProfileFollowersByUsername(
      username,
      this.requireUser(req).userId,
      query,
    );
  }

  @Get('username/:username/following')
  @UseGuards(JwtAuthGuard)
  async getProfileFollowing(
    @Req() req: RequestWithUser,
    @Param('username') username: string,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getProfileFollowingByUsername(
      username,
      this.requireUser(req).userId,
      query,
    );
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMyProfile(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateMyProfile(this.requireUser(req).userId, dto);
  }

  @Patch('me/avatar')
  @UseGuards(JwtAuthGuard)
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

    return this.profileService.updateMyAvatar(this.requireUser(req).userId, avatar);
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  async deleteMyAvatar(@Req() req: RequestWithUser): Promise<ProfileResponseDto> {
    return this.profileService.deleteMyAvatar(this.requireUser(req).userId);
  }

  @HttpPost('username/:username/follow')
  @UseGuards(JwtAuthGuard)
  async followUser(
    @Req() req: RequestWithUser,
    @Param('username') username: string,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.followUserByUsername(username, this.requireUser(req).userId);
  }

  @Delete('username/:username/follow')
  @UseGuards(JwtAuthGuard)
  async unfollowUser(
    @Req() req: RequestWithUser,
    @Param('username') username: string,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.unfollowUserByUsername(username, this.requireUser(req).userId);
  }

  @Get('username/:username/posts')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfilePublishedPostsByUsername(
    @Req() req: RequestWithUser,
    @Param('username') username: string,
    @Query() query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    return this.profileService.getProfilePublishedPostsByUsername(
      username,
      query,
      req.user?.userId ?? null,
    );
  }

  @Get('username/:username')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfileByUsername(
    @Req() req: RequestWithUser,
    @Param('username') username: string,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.getProfileByUsername(username, req.user?.userId ?? null);
  }

  @Get(':userId/followers')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfileFollowersById(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getProfileFollowersById(userId, req.user?.userId ?? null, query);
  }

  @Get(':userId/following')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfileFollowingById(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponseDto> {
    return this.profileService.getProfileFollowingById(userId, req.user?.userId ?? null, query);
  }

  @Get(':userId/posts')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfilePublishedPostsById(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: GetMyPostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    return this.profileService.getProfilePublishedPosts(userId, query, req.user?.userId ?? null);
  }

  @Get(':userId')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfileById(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PublicProfileResponseDto> {
    return this.profileService.getProfileById(userId, req.user?.userId ?? null);
  }
}
