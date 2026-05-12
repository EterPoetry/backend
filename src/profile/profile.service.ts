import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Follower } from '../followers/entities/follower.entity';
import { Post } from '../posts/entities/post.entity';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { rethrowUserUniqueConstraint } from '../users/user-conflict.util';
import { User } from '../users/entities/user.entity';
import { UsernameService } from '../users/username.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AvatarStorageService, UploadedAvatar } from './avatar-storage.service';

export interface ProfileResponse {
  userId: number;
  name: string;
  username: string;
  email: string;
  photo: string | null;
  isEmailVerified: boolean;
  isPremium: boolean;
  createdAt: Date;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Follower)
    private readonly followersRepository: Repository<Follower>,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    private readonly avatarStorageService: AvatarStorageService,
    private readonly usernameService: UsernameService,
  ) {}

  async getMyProfile(userId: number): Promise<ProfileResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.buildProfileResponse(user);
  }

  async updateMyProfile(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (dto.name !== undefined) {
      user.name = dto.name;
    }

    if (dto.username !== undefined) {
      user.username = await this.usernameService.validateAndReserveUsername(
        dto.username,
        user.userId,
      );
    }

    try {
      await this.usersRepository.save(user);
    } catch (error) {
      rethrowUserUniqueConstraint(error);
    }

    return this.buildProfileResponse(user);
  }

  async updateMyAvatar(userId: number, avatar: UploadedAvatar): Promise<ProfileResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    let newAvatarPath: string | null;
    const previousAvatarPath = user.photo;

    newAvatarPath = await this.avatarStorageService.saveAvatar(user.userId, avatar);
    user.photo = newAvatarPath;

    try {
      await this.usersRepository.save(user);
    } catch (error) {
      if (newAvatarPath) {
        await this.avatarStorageService.deleteAvatar(newAvatarPath);
      }
      throw error;
    }

    if (newAvatarPath && previousAvatarPath && previousAvatarPath !== newAvatarPath) {
      await this.avatarStorageService.deleteAvatar(previousAvatarPath);
    }

    return this.buildProfileResponse(user);
  }

  private async buildProfileResponse(user: User): Promise<ProfileResponse> {
    const [followersCount, followingCount, postsCount] = await Promise.all([
      this.followersRepository.countBy({ targetUserId: user.userId }),
      this.followersRepository.countBy({ followerUserId: user.userId }),
      this.postsRepository.countBy({ authorId: user.userId }),
    ]);

    return {
      userId: user.userId,
      name: user.name,
      username: user.username,
      email: user.email,
      photo: this.avatarStorageService.getAvatarUrl(user.photo),
      isEmailVerified: user.isEmailVerified,
      isPremium: user.subscription?.status === SubscriptionStatus.ACTIVE,
      createdAt: user.createdAt,
      followersCount,
      followingCount,
      postsCount,
    };
  }
}
