import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';
import { PostStatus } from '../common/enums/post-status.enum';
import { PostComplaint } from '../complaints/entities/post-complaint.entity';
import { Follower } from '../followers/entities/follower.entity';
import { Post } from '../posts/entities/post.entity';
import { GetMyPostsQueryDto } from '../posts/dto/get-my-posts-query.dto';
import { PaginatedPostsResponse, PostsService } from '../posts/posts.service';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { rethrowUserUniqueConstraint } from '../users/user-conflict.util';
import { User } from '../users/entities/user.entity';
import { UsernameService } from '../users/username.service';
import { GetProfileFollowListQueryDto } from './dto/get-profile-follow-list-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AvatarStorageService, UploadedAvatar } from './avatar-storage.service';

const DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK = 3;

export interface ProfileResponse {
  userId: number;
  name: string;
  username: string;
  email: string;
  photo: string | null;
  bio: string | null;
  link: string | null;
  isEmailVerified: boolean;
  isPremium: boolean;
  createdAt: Date;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  currentViolationsCount: number;
  maxViolationsBeforeBlock: number;
}

export interface PublicProfileResponse {
  userId: number;
  name: string;
  username: string;
  photo: string | null;
  bio: string | null;
  link: string | null;
  isPremium: boolean;
  isSubscribed: boolean;
  createdAt: Date;
  followersCount: number;
  followingCount: number;
  postsCount: number;
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

export interface ProfileFollowListItemResponse {
  userId: number;
  name: string;
  username: string;
  photo: string | null;
  isPremium: boolean;
  isSubscribed: boolean;
}

export interface PaginatedProfileFollowListResponse {
  items: ProfileFollowListItemResponse[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
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
    private readonly postsService: PostsService,
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

  async getProfileById(
    profileUserId: number,
    requesterUserId: number | null,
  ): Promise<PublicProfileResponse> {
    const user = await this.requireActiveUserById(profileUserId);
    return this.buildPublicProfileResponse(user, requesterUserId);
  }

  async getProfileByUsername(
    username: string,
    requesterUserId: number | null,
  ): Promise<PublicProfileResponse> {
    const user = await this.requireActiveUserByUsername(username);
    return this.buildPublicProfileResponse(user, requesterUserId);
  }

  async getProfilePublishedPostsByUsername(
    username: string,
    query: GetMyPostsQueryDto,
    requesterUserId: number | null,
  ): Promise<PaginatedPostsResponse> {
    const user = await this.requireActiveUserByUsername(username);
    return this.postsService.getPublishedPostsByAuthor(user.userId, query, requesterUserId);
  }

  private async requireActiveUserById(userId: number): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  private async requireActiveUserByUsername(username: string): Promise<User> {
    const normalizedUsername = this.usernameService.normalizeUsername(username);
    const user = await this.usersRepository.findOne({
      where: { username: normalizedUsername },
      relations: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
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

    if (dto.bio !== undefined) {
      user.bio = this.normalizeOptionalProfileField(dto.bio);
    }

    if (dto.link !== undefined) {
      user.link = this.normalizeOptionalProfileField(dto.link);
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

  async deleteMyAvatar(userId: number): Promise<ProfileResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const previousAvatarPath = user.photo;
    user.photo = null;
    await this.usersRepository.save(user);

    if (previousAvatarPath) {
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

  async getMyFollowers(
    userId: number,
    query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponse> {
    return this.getFollowList(userId, userId, query, 'followers');
  }

  async getMyFollowing(
    userId: number,
    query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponse> {
    return this.getFollowList(userId, userId, query, 'following');
  }

  async getProfileFollowersById(
    profileUserId: number,
    requesterUserId: number | null,
    query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponse> {
    await this.ensureUserExists(profileUserId);
    return this.getFollowList(profileUserId, requesterUserId, query, 'followers');
  }

  async getProfileFollowingById(
    profileUserId: number,
    requesterUserId: number | null,
    query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponse> {
    await this.ensureUserExists(profileUserId);
    return this.getFollowList(profileUserId, requesterUserId, query, 'following');
  }

  async getProfileFollowersByUsername(
    username: string,
    requesterUserId: number,
    query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponse> {
    const user = await this.requireActiveUserByUsername(username);
    return this.getFollowList(user.userId, requesterUserId, query, 'followers');
  }

  async getProfileFollowingByUsername(
    username: string,
    requesterUserId: number,
    query: GetProfileFollowListQueryDto,
  ): Promise<PaginatedProfileFollowListResponse> {
    const user = await this.requireActiveUserByUsername(username);
    return this.getFollowList(user.userId, requesterUserId, query, 'following');
  }

  async getProfilePublishedPosts(
    profileUserId: number,
    query: GetMyPostsQueryDto,
    requesterUserId: number | null,
  ): Promise<PaginatedPostsResponse> {
    await this.ensureUserExists(profileUserId);
    return this.postsService.getPublishedPostsByAuthor(profileUserId, query, requesterUserId);
  }

  async followUserByUsername(username: string, followerUserId: number): Promise<PublicProfileResponse> {
    const user = await this.requireActiveUserByUsername(username);
    return this.followUser(user.userId, followerUserId);
  }

  async unfollowUserByUsername(username: string, followerUserId: number): Promise<PublicProfileResponse> {
    const user = await this.requireActiveUserByUsername(username);
    return this.unfollowUser(user.userId, followerUserId);
  }

  async followUser(targetUserId: number, followerUserId: number): Promise<PublicProfileResponse> {
    if (targetUserId === followerUserId) {
      throw new BadRequestException('You cannot follow yourself.');
    }

    const targetUser = await this.usersRepository.findOne({
      where: { userId: targetUserId },
      relations: { subscription: true },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found.');
    }

    const alreadyFollowing = await this.followersRepository.exist({
      where: {
        followerUserId,
        targetUserId,
      },
    });

    if (!alreadyFollowing) {
      await this.followersRepository.save(
        this.followersRepository.create({
          followerUserId,
          targetUserId,
        }),
      );
    }

    return this.buildPublicProfileResponse(targetUser, followerUserId);
  }

  async unfollowUser(targetUserId: number, followerUserId: number): Promise<PublicProfileResponse> {
    if (targetUserId === followerUserId) {
      throw new BadRequestException('You cannot unfollow yourself.');
    }

    const targetUser = await this.usersRepository.findOne({
      where: { userId: targetUserId },
      relations: { subscription: true },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found.');
    }

    await this.followersRepository.delete({
      followerUserId,
      targetUserId,
    });

    return this.buildPublicProfileResponse(targetUser, followerUserId);
  }

  private async buildProfileResponse(user: User): Promise<ProfileResponse> {
    const [followersCount, followingCount, postsCount, currentViolationsCount] = await Promise.all([
      this.countActiveFollowers(user.userId),
      this.countActiveFollowing(user.userId),
      this.postsRepository.countBy({ authorId: user.userId, status: PostStatus.PUBLISHED }),
      this.countActiveViolations(user.userId),
    ]);

    return {
      userId: user.userId,
      name: user.name,
      username: user.username,
      email: user.email,
      photo: this.avatarStorageService.getAvatarUrl(user.photo),
      bio: user.bio,
      link: user.link,
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

  private async buildPublicProfileResponse(
    user: User,
    requesterUserId: number | null,
  ): Promise<PublicProfileResponse> {
    const [followersCount, followingCount, postsCount, isSubscribed] = await Promise.all([
      this.countActiveFollowers(user.userId),
      this.countActiveFollowing(user.userId),
      this.postsRepository.countBy({ authorId: user.userId, status: PostStatus.PUBLISHED }),
      requesterUserId === null ? Promise.resolve(false) : this.isFollowingActiveUser(requesterUserId, user.userId),
    ]);

    return {
      userId: user.userId,
      name: user.name,
      username: user.username,
      photo: this.avatarStorageService.getAvatarUrl(user.photo),
      bio: user.bio,
      link: user.link,
      isPremium: user.subscription?.status === SubscriptionStatus.ACTIVE,
      isSubscribed,
      createdAt: user.createdAt,
      followersCount,
      followingCount,
      postsCount,
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

  private normalizeOptionalProfileField(value: string | null): string | null {
    if (value === null) {
      return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
  }

  private async getFollowList(
    profileUserId: number,
    requesterUserId: number | null,
    query: GetProfileFollowListQueryDto,
    mode: 'followers' | 'following',
  ): Promise<PaginatedProfileFollowListResponse> {
    await this.ensureUserExists(profileUserId);

    const relationToListUserColumn =
      mode === 'followers' ? 'relation.follower_user_id' : 'relation.target_user_id';
    const relationToProfileColumn =
      mode === 'followers' ? 'relation.target_user_id' : 'relation.follower_user_id';

    const queryBuilder = this.usersRepository
      .createQueryBuilder('listUser')
      .innerJoin(
        Follower,
        'relation',
        `${relationToListUserColumn} = listUser.user_id AND ${relationToProfileColumn} = :profileUserId`,
        { profileUserId },
      )
      .leftJoin(
        Follower,
        'requesterFollow',
        'requesterFollow.follower_user_id = :requesterUserId AND requesterFollow.target_user_id = listUser.user_id',
        { requesterUserId },
      )
      .leftJoin('listUser.subscription', 'listUserSubscription')
      .where('listUser.deleted_at IS NULL');

    if (query.search?.trim()) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('listUser.name ILIKE :search').orWhere('listUser.username ILIKE :search');
        }),
        { search: `%${query.search.trim()}%` },
      );
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .select([
        'listUser.user_id AS user_id',
        'listUser.name AS name',
        'listUser.username AS username',
        'listUser.photo AS photo',
        'relation.created_at AS relation_created_at',
        'listUserSubscription.status AS subscription_status',
        'requesterFollow.follower_id AS requester_follow_id',
      ])
      .orderBy('relation.created_at', 'DESC')
      .addOrderBy('listUser.user_id', 'DESC');

    const cursor = this.parseFollowCursor(query.cursor);
    if (cursor) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('relation.created_at < :cursorCreatedAt', {
            cursorCreatedAt: cursor.createdAt,
          }).orWhere(
            'relation.created_at = :cursorCreatedAt AND listUser.user_id < :cursorUserId',
            {
              cursorCreatedAt: cursor.createdAt,
              cursorUserId: cursor.userId,
            },
          );
        }),
      );
    }
    queryBuilder.take(query.limit + 1);

    const rows = await queryBuilder.getRawMany<{
      user_id: number | string;
      name: string;
      username: string;
      photo: string | null;
      relation_created_at: string | Date;
      subscription_status: SubscriptionStatus | null;
      requester_follow_id: number | string | null;
    }>();

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? this.buildFollowCursor(pageRows.at(-1)) : null;

    return {
      items: pageRows.map((row) => ({
        userId: Number(row.user_id),
        name: row.name,
        username: row.username,
        photo: this.avatarStorageService.getAvatarUrl(row.photo),
        isPremium: row.subscription_status === SubscriptionStatus.ACTIVE,
        isSubscribed: row.requester_follow_id !== null && row.requester_follow_id !== undefined,
      })),
      total,
      limit: query.limit,
      nextCursor,
      hasMore,
    };
  }

  private parseFollowCursor(cursor?: string): { createdAt: string; userId: number } | null {
    if (!cursor) {
      return null;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Cursor is invalid.');
    }

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as { createdAt?: unknown }).createdAt !== 'string' ||
      !Number.isInteger((decoded as { userId?: unknown }).userId)
    ) {
      throw new BadRequestException('Cursor is invalid.');
    }

    return {
      createdAt: (decoded as { createdAt: string }).createdAt,
      userId: (decoded as { userId: number }).userId,
    };
  }

  private buildFollowCursor(
    row:
      | {
          relation_created_at: string | Date;
          user_id: number | string;
        }
      | undefined,
  ): string | null {
    if (!row) {
      return null;
    }

    const createdAt =
      row.relation_created_at instanceof Date
        ? row.relation_created_at.toISOString()
        : new Date(row.relation_created_at).toISOString();

    return Buffer.from(
      JSON.stringify({
        createdAt,
        userId: Number(row.user_id),
      }),
      'utf8',
    ).toString('base64url');
  }

  private async countActiveFollowers(userId: number): Promise<number> {
    const result = await this.followersRepository
      .createQueryBuilder('relation')
      .innerJoin('relation.followerUser', 'followerUser', 'followerUser.deleted_at IS NULL')
      .where('relation.target_user_id = :userId', { userId })
      .select('COUNT(relation.follower_id)', 'count')
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  private async countActiveFollowing(userId: number): Promise<number> {
    const result = await this.followersRepository
      .createQueryBuilder('relation')
      .innerJoin('relation.targetUser', 'targetUser', 'targetUser.deleted_at IS NULL')
      .where('relation.follower_user_id = :userId', { userId })
      .select('COUNT(relation.follower_id)', 'count')
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  private async isFollowingActiveUser(
    followerUserId: number,
    targetUserId: number,
  ): Promise<boolean> {
    const count = await this.followersRepository
      .createQueryBuilder('relation')
      .innerJoin('relation.targetUser', 'targetUser', 'targetUser.deleted_at IS NULL')
      .where('relation.follower_user_id = :followerUserId', { followerUserId })
      .andWhere('relation.target_user_id = :targetUserId', { targetUserId })
      .getCount();

    return count > 0;
  }
}
