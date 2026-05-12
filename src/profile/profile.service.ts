import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';
import { PostComplaint } from '../complaints/entities/post-complaint.entity';
import { Follower } from '../followers/entities/follower.entity';
import { Post } from '../posts/entities/post.entity';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { rethrowUserUniqueConstraint } from '../users/user-conflict.util';
import { User } from '../users/entities/user.entity';
import { UsernameService } from '../users/username.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AvatarStorageService, UploadedAvatar } from './avatar-storage.service';

const DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK = 3;

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
  currentViolationsCount: number;
  maxViolationsBeforeBlock: number;
}

export interface ActiveViolationResponse {
  complaintId: number;
  complaintReason: string;
  status: ComplaintStatus;
  createdAt: Date;
  expiresAt: Date | null;
  targetPost: ActiveViolationTargetPostResponse;
}

export interface ActiveViolationTargetPostResponse {
  postId: number;
  title: string | null;
  description: string | null;
  text: string | null;
  audioFileName: string | null;
  createdAt: Date;
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
    @InjectRepository(PostComplaint)
    private readonly complaintsRepository: Repository<PostComplaint>,
    private readonly configService: ConfigService,
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

  async getMyActiveViolations(userId: number): Promise<ActiveViolationResponse[]> {
    await this.ensureUserExists(userId);

    const complaints = await this.complaintsRepository
      .createQueryBuilder('complaint')
      .leftJoinAndSelect('complaint.targetPost', 'targetPost')
      .where('complaint.target_user_id = :userId', { userId })
      .andWhere('complaint.status = :status', { status: ComplaintStatus.RESOLVED })
      .andWhere(
        new Brackets((qb) => {
          qb.where('complaint.expires_at IS NULL').orWhere('complaint.expires_at > NOW()');
        }),
      )
      .orderBy('complaint.expires_at', 'ASC', 'NULLS LAST')
      .addOrderBy('complaint.created_at', 'DESC')
      .getMany();

    return complaints.map((complaint) => ({
      complaintId: complaint.postComplaintId,
      complaintReason: complaint.complaintReason,
      status: complaint.status,
      createdAt: complaint.createdAt,
      expiresAt: complaint.expiresAt,
      targetPost: {
        postId: complaint.targetPost.postId,
        title: complaint.targetPost.title,
        description: complaint.targetPost.description,
        text: complaint.targetPost.text,
        audioFileName: complaint.targetPost.audioFileName,
        createdAt: complaint.targetPost.createdAt,
      },
    }));
  }

  private async buildProfileResponse(user: User): Promise<ProfileResponse> {
    const [followersCount, followingCount, postsCount, currentViolationsCount] = await Promise.all([
      this.followersRepository.countBy({ targetUserId: user.userId }),
      this.followersRepository.countBy({ followerUserId: user.userId }),
      this.postsRepository.countBy({ authorId: user.userId }),
      this.countActiveViolations(user.userId),
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
      currentViolationsCount,
      maxViolationsBeforeBlock: this.getMaxViolationsBeforeBlock(),
    };
  }

  private async countActiveViolations(userId: number): Promise<number> {
    return this.complaintsRepository
      .createQueryBuilder('complaint')
      .where('complaint.target_user_id = :userId', { userId })
      .andWhere('complaint.status = :status', { status: ComplaintStatus.RESOLVED })
      .andWhere(
        new Brackets((qb) => {
          qb.where('complaint.expires_at IS NULL').orWhere('complaint.expires_at > NOW()');
        }),
      )
      .getCount();
  }

  private getMaxViolationsBeforeBlock(): number {
    const rawValue = this.configService.get<string>('MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK')?.trim();
    if (!rawValue) {
      return DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      return DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK;
    }

    return parsedValue;
  }

  private async ensureUserExists(userId: number): Promise<void> {
    const exists = await this.usersRepository.exist({ where: { userId } });
    if (!exists) {
      throw new NotFoundException('User not found.');
    }
  }
}
