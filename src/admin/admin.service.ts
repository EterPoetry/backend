import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { PostCategory } from '../categories/entities/post-category.entity';
import { ComplaintReason, COMPLAINT_REASON_LABELS } from '../common/enums/complaint-reason.enum';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';
import { PostStatus } from '../common/enums/post-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { Post } from '../posts/entities/post.entity';
import { SortOrder } from '../posts/dto/get-my-posts-query.dto';
import { RateLimitedMailService } from '../mail/rate-limited-mail.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminRole } from './admin-role.enum';
import { GetAdminsQueryDto, AdminListSortBy } from './dto/admin-query.dto';
import { CreateAdminCategoryDto, UpdateAdminCategoryDto } from './dto/upsert-category.dto';
import { GetAdminCategoriesQueryDto, AdminCategoryListSortBy } from './dto/category-query.dto';
import { GetAdminComplaintsQueryDto, AdminComplaintListSortBy } from './dto/complaint-query.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { AdminStatsInterval, GetAdminStatsQueryDto } from './dto/stats-query.dto';
import { AdminUserListSortBy, GetAdminUsersQueryDto } from './dto/user-query.dto';
import { Admin } from './entities/admin.entity';
import { PostComplaint } from '../complaints/entities/post-complaint.entity';

const DEFAULT_VIOLATION_DURATION_DAYS = 60;
const DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK = 3;

export interface OffsetPaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface AdminListItemResponse {
  adminId: number;
  name: string;
  email: string;
  role: AdminRole.ADMIN;
  isActive: boolean;
  inviteExpiresAt: Date | null;
  createdAt: Date;
}

export interface AdminUserListItemResponse {
  userId: number;
  name: string;
  username: string;
  email: string;
  createdAt: Date;
  blockedAt: Date | null;
  postsCount: number;
  activeViolationsCount: number;
}

export interface AdminUserViolationResponse {
  complaintId: number;
  complaintReason: ComplaintReason;
  complaintReasonLabel: string;
  status: ComplaintStatus;
  createdAt: Date;
  processedAt: Date | null;
  expiresAt: Date | null;
  adminId: number | null;
  postId: number;
  postStatus: PostStatus;
}

export interface AdminUserDetailsResponse extends AdminUserListItemResponse {
  violations: AdminUserViolationResponse[];
}

export interface AdminCategoryResponse {
  categoryId: number;
  categoryName: string;
  categoryDescription: string | null;
  postsCount: number;
}

export interface AdminComplaintResponse {
  complaintId: number;
  complaintReason: ComplaintReason;
  complaintReasonLabel: string;
  status: ComplaintStatus;
  createdAt: Date;
  processedAt: Date | null;
  expiresAt: Date | null;
  author: {
    userId: number;
    name: string;
    username: string;
    email: string;
  };
  targetUser: {
    userId: number;
    name: string;
    username: string;
    email: string;
    blockedAt: Date | null;
  };
  targetPost: {
    postId: number;
    slug: string;
    title: string | null;
    status: PostStatus;
  };
  processedByAdmin: {
    adminId: number;
    name: string;
    email: string;
  } | null;
}

export interface AdminOverviewStatsResponse {
  users: { total: number; active: number; blocked: number };
  posts: { total: number; published: number; removed: number };
  complaints: { total: number; pending: number; resolved: number; dismissed: number };
}

export interface AdminStatsTimeseriesPointResponse {
  bucketStart: string;
  users: { total: number; active: number; blocked: number };
  posts: { total: number; published: number; removed: number };
  complaints: { total: number; pending: number; resolved: number; dismissed: number };
}

export interface AdminStatsTimeseriesResponse {
  interval: AdminStatsInterval;
  from: string;
  to: string;
  items: AdminStatsTimeseriesPointResponse[];
}

@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Admin)
    private readonly adminsRepository: Repository<Admin>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(PostCategory)
    private readonly postCategoriesRepository: Repository<PostCategory>,
    @InjectRepository(PostComplaint)
    private readonly complaintsRepository: Repository<PostComplaint>,
    private readonly adminAuthService: AdminAuthService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: RateLimitedMailService,
    private readonly configService: ConfigService,
  ) {}

  async listAdmins(query: GetAdminsQueryDto): Promise<OffsetPaginatedResponse<AdminListItemResponse>> {
    await this.adminAuthService.deleteExpiredPendingInvites();

    const queryBuilder = this.adminsRepository
      .createQueryBuilder('admin')
      .where('admin.role = :role', { role: AdminRole.ADMIN });

    if (query.search?.trim()) {
      queryBuilder.andWhere(
        '(admin.name ILIKE :search OR admin.email ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }

    this.applyAdminSorting(queryBuilder, query.sortBy, query.sortOrder);

    const [admins, total] = await queryBuilder
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: admins.map((admin) => this.mapAdminListItem(admin)),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  }

  async inviteAdmin(dto: InviteAdminDto): Promise<{ ok: true }> {
    await this.adminAuthService.deleteExpiredPendingInvites();

    let admin = await this.adminsRepository.findOne({
      where: { email: dto.email },
    });

    if (admin) {
      if (admin.role === AdminRole.GLOBAL_ADMIN) {
        throw new ConflictException('Global admin accounts cannot be managed.');
      }

      if (admin.isActive) {
        throw new ConflictException('Admin already exists.');
      }
    } else {
      admin = this.adminAuthService.buildInvite(dto.email);
    }

    const invite = this.adminAuthService.generateInviteToken();
    admin.inviteTokenHash = invite.tokenHash;
    admin.inviteExpiresAt = invite.expiresAt;
    admin.isActive = false;
    admin.password = null;

    const savedAdmin = await this.adminsRepository.save(admin);
    await this.adminAuthService.sendInvitationEmail(savedAdmin, invite.token);

    return { ok: true };
  }

  async deleteAdmin(adminId: number): Promise<{ ok: true }> {
    const admin = await this.adminsRepository.findOne({ where: { adminId } });
    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }

    if (admin.role === AdminRole.GLOBAL_ADMIN) {
      throw new BadRequestException('Global admins cannot be managed.');
    }

    await this.adminsRepository.delete({ adminId });
    return { ok: true };
  }

  async listUsers(query: GetAdminUsersQueryDto): Promise<OffsetPaginatedResponse<AdminUserListItemResponse>> {
    const queryBuilder = this.usersRepository
      .createQueryBuilder('appUser')
      .withDeleted()
      .select([
        'appUser.userId AS "userId"',
        'appUser.name AS "name"',
        'appUser.username AS "username"',
        'appUser.email AS "email"',
        'appUser.created_at AS "createdAt"',
        'appUser.blocked_at AS "blockedAt"',
      ])
      .addSelect(
        `(SELECT COUNT(*)::int FROM posts post WHERE post.author_id = "appUser"."user_id")`,
        'postsCount',
      )
      .addSelect(
        `(SELECT COUNT(*)::int
            FROM post_complaints complaint
           WHERE complaint.target_user_id = "appUser"."user_id"
             AND complaint.status = :resolvedStatus
             AND (complaint.expires_at IS NULL OR complaint.expires_at > NOW()))`,
        'activeViolationsCount',
      )
      .setParameter('resolvedStatus', ComplaintStatus.RESOLVED);

    if (query.search?.trim()) {
      queryBuilder.where(
        '(appUser.name ILIKE :search OR appUser.username ILIKE :search OR appUser.email ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }

    this.applyUserSorting(queryBuilder, query.sortBy, query.sortOrder);

    const total = await queryBuilder.clone().getCount();
    const rows = await queryBuilder.offset(query.offset).limit(query.limit).getRawMany<{
      userId: string;
      name: string;
      username: string;
      email: string;
      createdAt: Date;
      blockedAt: Date | null;
      postsCount: string;
      activeViolationsCount: string;
    }>();

    return {
      items: rows.map((row) => ({
        userId: Number(row.userId),
        name: row.name,
        username: row.username,
        email: row.email,
        createdAt: new Date(row.createdAt),
        blockedAt: row.blockedAt ? new Date(row.blockedAt) : null,
        postsCount: Number(row.postsCount ?? 0),
        activeViolationsCount: Number(row.activeViolationsCount ?? 0),
      })),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  }

  async getUserDetails(userId: number): Promise<AdminUserDetailsResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      withDeleted: true,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const [postsCount, activeViolationsCount, violations] = await Promise.all([
      this.postsRepository.count({ where: { authorId: userId } }),
      this.countActiveViolations(userId),
      this.complaintsRepository.find({
        where: { targetUserId: userId },
        relations: {
          targetPost: true,
        },
        order: {
          createdAt: 'DESC',
        },
      }),
    ]);

    return {
      userId: user.userId,
      name: user.name,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      blockedAt: user.blockedAt,
      postsCount,
      activeViolationsCount,
      violations: violations.map((violation) => ({
        complaintId: violation.postComplaintId,
        complaintReason: violation.complaintReason,
        complaintReasonLabel: COMPLAINT_REASON_LABELS[violation.complaintReason],
        status: violation.status,
        createdAt: violation.createdAt,
        processedAt: violation.processedAt,
        expiresAt: violation.expiresAt,
        adminId: violation.adminId,
        postId: violation.targetPostId,
        postStatus: violation.targetPost.status,
      })),
    };
  }

  async blockUser(userId: number): Promise<{ ok: true }> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      withDeleted: true,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!user.blockedAt) {
      await this.usersService.blockUser(userId);
      await this.mailService.sendAccountBlockedEmail({
        email: user.email,
        name: user.name,
      });
    }

    return { ok: true };
  }

  async unblockUser(userId: number): Promise<{ ok: true }> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      withDeleted: true,
    });

    if (!user?.blockedAt) {
      throw new NotFoundException('Blocked user not found.');
    }

    const activeViolationsCount = await this.countActiveViolations(userId);
    if (activeViolationsCount >= this.getMaxViolationsBeforeBlock()) {
      throw new BadRequestException('User still has too many active violations to be unblocked.');
    }

    await this.usersService.unblockUser(userId);
    await this.mailService.sendAccountUnblockedEmail({
      email: user.email,
      name: user.name,
    });

    return { ok: true };
  }

  async removeViolation(userId: number, complaintId: number): Promise<{ ok: true; userBlocked: boolean }> {
    const complaint = await this.complaintsRepository.findOne({
      where: {
        postComplaintId: complaintId,
        targetUserId: userId,
        status: ComplaintStatus.RESOLVED,
      },
    });

    if (!complaint) {
      throw new NotFoundException('Violation not found.');
    }

    if (complaint.expiresAt && complaint.expiresAt <= new Date()) {
      throw new BadRequestException('Violation is already inactive.');
    }

    complaint.expiresAt = new Date();
    await this.complaintsRepository.save(complaint);

    const user = await this.usersRepository.findOne({
      where: { userId },
      withDeleted: true,
    });

    const activeViolationsCount = await this.countActiveViolations(userId);
    if (user?.blockedAt && activeViolationsCount < this.getMaxViolationsBeforeBlock()) {
      await this.usersService.unblockUser(userId);
      await this.mailService.sendAccountUnblockedEmail({
        email: user.email,
        name: user.name,
      });
      return { ok: true, userBlocked: false };
    }

    return { ok: true, userBlocked: Boolean(user?.blockedAt) };
  }

  async listCategories(
    query: GetAdminCategoriesQueryDto,
  ): Promise<OffsetPaginatedResponse<AdminCategoryResponse>> {
    const queryBuilder = this.categoriesRepository
      .createQueryBuilder('category')
      .select([
        'category.category_id AS "categoryId"',
        'category.category_name AS "categoryName"',
        'category.category_description AS "categoryDescription"',
      ])
      .addSelect(
        '(SELECT COUNT(*)::int FROM post_categories postCategory WHERE postCategory.category_id = category.category_id)',
        'postsCount',
      );

    if (query.search?.trim()) {
      queryBuilder.where(
        '(category.category_name ILIKE :search OR COALESCE(category.category_description, \'\') ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }

    const sortColumn =
      query.sortBy === AdminCategoryListSortBy.ID ? 'category.category_id' : 'category.category_name';
    queryBuilder.orderBy(sortColumn, query.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC');

    const total = await queryBuilder.clone().getCount();
    const rows = await queryBuilder.offset(query.offset).limit(query.limit).getRawMany<{
      categoryId: string;
      categoryName: string;
      categoryDescription: string | null;
      postsCount: string;
    }>();

    return {
      items: rows.map((row) => ({
        categoryId: Number(row.categoryId),
        categoryName: row.categoryName,
        categoryDescription: row.categoryDescription,
        postsCount: Number(row.postsCount ?? 0),
      })),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  }

  async createCategory(dto: CreateAdminCategoryDto): Promise<AdminCategoryResponse> {
    await this.ensureCategoryNameIsAvailable(dto.categoryName);

    const category = await this.categoriesRepository.save(
      this.categoriesRepository.create({
        categoryName: dto.categoryName.trim(),
        categoryDescription: this.normalizeNullableText(dto.categoryDescription),
      }),
    );

    return {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      categoryDescription: category.categoryDescription,
      postsCount: 0,
    };
  }

  async updateCategory(categoryId: number, dto: UpdateAdminCategoryDto): Promise<AdminCategoryResponse> {
    const category = await this.categoriesRepository.findOne({ where: { categoryId } });
    if (!category) {
      throw new NotFoundException('Category not found.');
    }

    if (dto.categoryName && dto.categoryName.trim().toLowerCase() !== category.categoryName.toLowerCase()) {
      await this.ensureCategoryNameIsAvailable(dto.categoryName, categoryId);
      category.categoryName = dto.categoryName.trim();
    }

    if (dto.categoryDescription !== undefined) {
      category.categoryDescription = this.normalizeNullableText(dto.categoryDescription);
    }

    const savedCategory = await this.categoriesRepository.save(category);
    const postsCount = await this.postCategoriesRepository.countBy({ categoryId });

    return {
      categoryId: savedCategory.categoryId,
      categoryName: savedCategory.categoryName,
      categoryDescription: savedCategory.categoryDescription,
      postsCount,
    };
  }

  async deleteCategory(categoryId: number): Promise<{ ok: true }> {
    const category = await this.categoriesRepository.findOne({ where: { categoryId } });
    if (!category) {
      throw new NotFoundException('Category not found.');
    }

    await this.postCategoriesRepository.delete({ categoryId });
    await this.categoriesRepository.delete({ categoryId });
    return { ok: true };
  }

  async listComplaints(
    query: GetAdminComplaintsQueryDto,
  ): Promise<OffsetPaginatedResponse<AdminComplaintResponse>> {
    const queryBuilder = this.complaintsRepository
      .createQueryBuilder('complaint')
      .innerJoinAndSelect('complaint.author', 'author')
      .innerJoinAndSelect('complaint.targetUser', 'targetUser')
      .innerJoinAndSelect('complaint.targetPost', 'targetPost')
      .leftJoinAndSelect('complaint.admin', 'admin')
      .withDeleted();

    if (query.search?.trim()) {
      queryBuilder.where(
        `(
          author.name ILIKE :search
          OR author.username ILIKE :search
          OR targetUser.name ILIKE :search
          OR targetUser.username ILIKE :search
          OR complaint.complaint_reason::text ILIKE :search
        )`,
        { search: `%${query.search.trim()}%` },
      );
    }

    if (query.status) {
      queryBuilder.andWhere('complaint.status = :status', { status: query.status });
    }

    this.applyComplaintSorting(queryBuilder, query.sortBy, query.sortOrder);

    const [complaints, total] = await queryBuilder
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: complaints.map((complaint) => this.mapComplaintResponse(complaint)),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  }

  async acceptComplaint(complaintId: number, adminId: number): Promise<AdminComplaintResponse> {
    const expiresAt = this.getViolationExpiryDate();
    const result = await this.dataSource.transaction(async (manager) => {
      const complaintsRepository = manager.getRepository(PostComplaint);
      const postsRepository = manager.getRepository(Post);

      const complaint = await complaintsRepository.findOne({
        where: { postComplaintId: complaintId },
        relations: {
          author: true,
          targetUser: true,
          targetPost: true,
          admin: true,
        },
        withDeleted: true,
      });

      if (!complaint) {
        throw new NotFoundException('Complaint not found.');
      }

      if (complaint.status !== ComplaintStatus.PENDING) {
        throw new ConflictException('Only pending complaints can be accepted.');
      }

      complaint.status = ComplaintStatus.RESOLVED;
      complaint.adminId = adminId;
      complaint.processedAt = new Date();
      complaint.expiresAt = expiresAt;
      await complaintsRepository.save(complaint);

      await complaintsRepository
        .createQueryBuilder()
        .update(PostComplaint)
        .set({
          status: ComplaintStatus.DISMISSED,
          adminId,
          processedAt: () => 'NOW()',
        })
        .where('target_post_id = :targetPostId', { targetPostId: complaint.targetPostId })
        .andWhere('post_complaint_id != :complaintId', { complaintId })
        .andWhere('status = :pendingStatus', { pendingStatus: ComplaintStatus.PENDING })
        .execute();

      await postsRepository.update(complaint.targetPostId, {
        title: null,
        description: null,
        text: null,
        originAuthorName: null,
        status: PostStatus.REMOVED,
        removedAt: new Date(),
      });

      return complaint;
    });

    await this.notificationsService.recordPostViolationConfirmed(
      result.targetUserId,
      result.targetPostId,
      result.postComplaintId,
    );
    await this.mailService.sendViolationEmail(
      {
        email: result.targetUser.email,
        name: result.targetUser.name,
      },
      COMPLAINT_REASON_LABELS[result.complaintReason],
      expiresAt,
    );

    await this.autoBlockUserIfNeeded(result.targetUserId);
    return this.getComplaintById(complaintId);
  }

  async dismissComplaint(complaintId: number, adminId: number): Promise<AdminComplaintResponse> {
    const complaint = await this.complaintsRepository.findOne({
      where: { postComplaintId: complaintId },
      relations: {
        author: true,
        targetUser: true,
        targetPost: true,
        admin: true,
      },
      withDeleted: true,
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found.');
    }

    if (complaint.status !== ComplaintStatus.PENDING) {
      throw new ConflictException('Only pending complaints can be dismissed.');
    }

    complaint.status = ComplaintStatus.DISMISSED;
    complaint.adminId = adminId;
    complaint.processedAt = new Date();
    await this.complaintsRepository.save(complaint);

    return this.getComplaintById(complaintId);
  }

  async getOverviewStats(): Promise<AdminOverviewStatsResponse> {
    const [totalUsers, activeUsers, blockedUsers, totalPosts, publishedPosts, removedPosts, totalComplaints, pendingComplaints, resolvedComplaints, dismissedComplaints] =
      await Promise.all([
        this.usersRepository.count({ withDeleted: true }),
        this.usersRepository.count(),
        this.usersRepository.count({ withDeleted: true, where: { blockedAt: Not(IsNull()) } }),
        this.postsRepository.count(),
        this.postsRepository.count({ where: { status: PostStatus.PUBLISHED } }),
        this.postsRepository.count({ where: { status: PostStatus.REMOVED } }),
        this.complaintsRepository.count(),
        this.complaintsRepository.count({ where: { status: ComplaintStatus.PENDING } }),
        this.complaintsRepository.count({ where: { status: ComplaintStatus.RESOLVED } }),
        this.complaintsRepository.count({ where: { status: ComplaintStatus.DISMISSED } }),
      ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        blocked: blockedUsers,
      },
      posts: {
        total: totalPosts,
        published: publishedPosts,
        removed: removedPosts,
      },
      complaints: {
        total: totalComplaints,
        pending: pendingComplaints,
        resolved: resolvedComplaints,
        dismissed: dismissedComplaints,
      },
    };
  }

  async getTimeseries(query: GetAdminStatsQueryDto): Promise<AdminStatsTimeseriesResponse> {
    const { from, to, step } = this.resolveStatsWindow(query);
    const usersRows = await this.dataSource.query(
      `
      SELECT bucket_start,
        (SELECT COUNT(*) FROM users u WHERE u.created_at < bucket_start + $3::interval) AS total,
        (SELECT COUNT(*) FROM users u
          WHERE u.created_at < bucket_start + $3::interval
            AND (u.blocked_at IS NULL OR u.blocked_at >= bucket_start + $3::interval)) AS active,
        (SELECT COUNT(*) FROM users u
          WHERE u.blocked_at IS NOT NULL
            AND u.blocked_at < bucket_start + $3::interval) AS blocked
      FROM generate_series($1::timestamptz, $2::timestamptz, $3::interval) AS bucket_start
      `,
      [from.toISOString(), to.toISOString(), step],
    );

    const postsRows = await this.dataSource.query(
      `
      SELECT bucket_start,
        (SELECT COUNT(*) FROM posts p WHERE p.created_at < bucket_start + $3::interval) AS total,
        (SELECT COUNT(*) FROM posts p
          WHERE p.published_at IS NOT NULL
            AND p.published_at < bucket_start + $3::interval
            AND (p.removed_at IS NULL OR p.removed_at >= bucket_start + $3::interval)) AS published,
        (SELECT COUNT(*) FROM posts p
          WHERE p.removed_at IS NOT NULL
            AND p.removed_at < bucket_start + $3::interval) AS removed
      FROM generate_series($1::timestamptz, $2::timestamptz, $3::interval) AS bucket_start
      `,
      [from.toISOString(), to.toISOString(), step],
    );

    const complaintsRows = await this.dataSource.query(
      `
      SELECT bucket_start,
        (SELECT COUNT(*) FROM post_complaints c WHERE c.created_at < bucket_start + $3::interval) AS total,
        (SELECT COUNT(*) FROM post_complaints c
          WHERE c.created_at < bucket_start + $3::interval
            AND (c.processed_at IS NULL OR c.processed_at >= bucket_start + $3::interval)) AS pending,
        (SELECT COUNT(*) FROM post_complaints c
          WHERE c.status = 'resolved'
            AND c.processed_at IS NOT NULL
            AND c.processed_at < bucket_start + $3::interval) AS resolved,
        (SELECT COUNT(*) FROM post_complaints c
          WHERE c.status = 'dismissed'
            AND c.processed_at IS NOT NULL
            AND c.processed_at < bucket_start + $3::interval) AS dismissed
      FROM generate_series($1::timestamptz, $2::timestamptz, $3::interval) AS bucket_start
      `,
      [from.toISOString(), to.toISOString(), step],
    );

    const items = usersRows.map((userRow: Record<string, string>, index: number) => {
      const postsRow = postsRows[index] as Record<string, string>;
      const complaintsRow = complaintsRows[index] as Record<string, string>;

      return {
        bucketStart: new Date(userRow.bucket_start).toISOString(),
        users: {
          total: Number(userRow.total),
          active: Number(userRow.active),
          blocked: Number(userRow.blocked),
        },
        posts: {
          total: Number(postsRow.total),
          published: Number(postsRow.published),
          removed: Number(postsRow.removed),
        },
        complaints: {
          total: Number(complaintsRow.total),
          pending: Number(complaintsRow.pending),
          resolved: Number(complaintsRow.resolved),
          dismissed: Number(complaintsRow.dismissed),
        },
      };
    });

    return {
      interval: query.interval,
      from: from.toISOString(),
      to: to.toISOString(),
      items,
    };
  }

  private async getComplaintById(complaintId: number): Promise<AdminComplaintResponse> {
    const complaint = await this.complaintsRepository.findOne({
      where: { postComplaintId: complaintId },
      relations: {
        author: true,
        targetUser: true,
        targetPost: true,
        admin: true,
      },
      withDeleted: true,
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found.');
    }

    return this.mapComplaintResponse(complaint);
  }

  private async autoBlockUserIfNeeded(userId: number): Promise<void> {
    const activeViolationsCount = await this.countActiveViolations(userId);
    if (activeViolationsCount < this.getMaxViolationsBeforeBlock()) {
      return;
    }

    const user = await this.usersRepository.findOne({
      where: { userId },
      withDeleted: true,
    });

    if (!user || user.blockedAt) {
      return;
    }

    await this.usersService.blockUser(userId);
    await this.mailService.sendAccountBlockedEmail({
      email: user.email,
      name: user.name,
    });
  }

  private async countActiveViolations(userId: number): Promise<number> {
    return this.complaintsRepository
      .createQueryBuilder('complaint')
      .where('complaint.target_user_id = :userId', { userId })
      .andWhere('complaint.status = :status', { status: ComplaintStatus.RESOLVED })
      .andWhere('(complaint.expires_at IS NULL OR complaint.expires_at > NOW())')
      .getCount();
  }

  private getMaxViolationsBeforeBlock(): number {
    const rawValue = this.configService.get<string>('MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK')?.trim();
    const parsedValue = rawValue ? Number(rawValue) : DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK;

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return DEFAULT_MAX_ACTIVE_VIOLATIONS_BEFORE_BLOCK;
    }

    return Math.floor(parsedValue);
  }

  private getViolationExpiryDate(): Date {
    return new Date(Date.now() + DEFAULT_VIOLATION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  }

  private normalizeNullableText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
  }

  private async ensureCategoryNameIsAvailable(
    categoryName: string,
    currentCategoryId?: number,
  ): Promise<void> {
    const normalizedName = categoryName.trim().toLowerCase();
    const existingCategory = await this.categoriesRepository
      .createQueryBuilder('category')
      .where('LOWER(category.category_name) = :categoryName', { categoryName: normalizedName })
      .andWhere(currentCategoryId ? 'category.category_id != :categoryId' : '1 = 1', {
        categoryId: currentCategoryId,
      })
      .getOne();

    if (existingCategory) {
      throw new ConflictException('Category name is already in use.');
    }
  }

  private mapAdminListItem(admin: Admin): AdminListItemResponse {
    return {
      adminId: admin.adminId,
      name: admin.name,
      email: admin.email,
      role: AdminRole.ADMIN,
      isActive: admin.isActive,
      inviteExpiresAt: admin.inviteExpiresAt,
      createdAt: admin.createdAt,
    };
  }

  private mapComplaintResponse(complaint: PostComplaint): AdminComplaintResponse {
    return {
      complaintId: complaint.postComplaintId,
      complaintReason: complaint.complaintReason,
      complaintReasonLabel: COMPLAINT_REASON_LABELS[complaint.complaintReason],
      status: complaint.status,
      createdAt: complaint.createdAt,
      processedAt: complaint.processedAt,
      expiresAt: complaint.expiresAt,
      author: {
        userId: complaint.author.userId,
        name: complaint.author.name,
        username: complaint.author.username,
        email: complaint.author.email,
      },
      targetUser: {
        userId: complaint.targetUser.userId,
        name: complaint.targetUser.name,
        username: complaint.targetUser.username,
        email: complaint.targetUser.email,
        blockedAt: complaint.targetUser.blockedAt,
      },
      targetPost: {
        postId: complaint.targetPost.postId,
        slug: complaint.targetPost.slug,
        title: complaint.targetPost.title,
        status: complaint.targetPost.status,
      },
      processedByAdmin: complaint.admin
        ? {
            adminId: complaint.admin.adminId,
            name: complaint.admin.name,
            email: complaint.admin.email,
          }
        : null,
    };
  }

  private applyAdminSorting(
    queryBuilder: ReturnType<Repository<Admin>['createQueryBuilder']>,
    sortBy: AdminListSortBy,
    sortOrder: SortOrder,
  ): void {
    const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    switch (sortBy) {
      case AdminListSortBy.NAME:
        queryBuilder.orderBy('admin.name', direction).addOrderBy('admin.adminId', 'DESC');
        return;
      case AdminListSortBy.EMAIL:
        queryBuilder.orderBy('admin.email', direction).addOrderBy('admin.adminId', 'DESC');
        return;
      default:
        queryBuilder.orderBy('admin.createdAt', direction).addOrderBy('admin.adminId', 'DESC');
    }
  }

  private applyUserSorting(
    queryBuilder: ReturnType<Repository<User>['createQueryBuilder']>,
    sortBy: AdminUserListSortBy,
    sortOrder: SortOrder,
  ): void {
    const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    switch (sortBy) {
      case AdminUserListSortBy.NAME:
        queryBuilder.orderBy('appUser.name', direction).addOrderBy('appUser.user_id', 'DESC');
        return;
      case AdminUserListSortBy.USERNAME:
        queryBuilder.orderBy('appUser.username', direction).addOrderBy('appUser.user_id', 'DESC');
        return;
      case AdminUserListSortBy.POSTS_COUNT:
        queryBuilder.orderBy('"postsCount"', direction).addOrderBy('appUser.user_id', 'DESC');
        return;
      case AdminUserListSortBy.ACTIVE_VIOLATIONS_COUNT:
        queryBuilder.orderBy('"activeViolationsCount"', direction).addOrderBy('appUser.user_id', 'DESC');
        return;
      default:
        queryBuilder.orderBy('appUser.created_at', direction).addOrderBy('appUser.user_id', 'DESC');
    }
  }

  private applyComplaintSorting(
    queryBuilder: ReturnType<Repository<PostComplaint>['createQueryBuilder']>,
    sortBy: AdminComplaintListSortBy,
    sortOrder: SortOrder,
  ): void {
    const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    switch (sortBy) {
      case AdminComplaintListSortBy.STATUS:
        queryBuilder.orderBy('complaint.status', direction).addOrderBy('complaint.postComplaintId', 'DESC');
        return;
      case AdminComplaintListSortBy.REASON:
        queryBuilder.orderBy('complaint.complaintReason', direction).addOrderBy('complaint.postComplaintId', 'DESC');
        return;
      default:
        queryBuilder.orderBy('complaint.createdAt', direction).addOrderBy('complaint.postComplaintId', 'DESC');
    }
  }

  private resolveStatsWindow(query: GetAdminStatsQueryDto): {
    from: Date;
    to: Date;
    step: string;
  } {
    const step =
      query.interval === AdminStatsInterval.WEEKLY
        ? '1 week'
        : query.interval === AdminStatsInterval.MONTHLY
          ? '1 month'
          : '1 day';

    const now = new Date();
    const fallbackFrom =
      query.interval === AdminStatsInterval.WEEKLY
        ? new Date(now.getTime() - 24 * 7 * 24 * 60 * 60 * 1000)
        : query.interval === AdminStatsInterval.MONTHLY
          ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
          : new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);

    const from = query.from ? new Date(query.from) : fallbackFrom;
    const to = query.to ? new Date(query.to) : now;

    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new BadRequestException('Stats date range is invalid.');
    }

    return { from, to, step };
  }
}
