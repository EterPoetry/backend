import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
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
import { UploadedAvatar } from './avatar-storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponse, ProfileService } from './profile.service';

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
  email: string;

  @ApiPropertyOptional({ nullable: true })
  photo: string | null;

  @ApiProperty()
  isEmailVerified: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  followersCount: number;

  @ApiProperty()
  followingCount: number;

  @ApiProperty()
  postsCount: number;
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
}
