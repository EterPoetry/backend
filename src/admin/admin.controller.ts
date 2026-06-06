import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ComplaintReason } from '../common/enums/complaint-reason.enum';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';
import {
  AdminCategoryResponse,
  AdminComplaintResponse,
  AdminListItemResponse,
  AdminOverviewStatsResponse,
  AdminService,
  AdminStatsTimeseriesPointResponse,
  AdminStatsTimeseriesResponse,
  AdminUserDetailsResponse,
  AdminUserListItemResponse,
  AdminUserViolationResponse,
  OffsetPaginatedResponse,
} from './admin.service';
import { AdminRole } from './admin-role.enum';
import { GetAdminsQueryDto } from './dto/admin-query.dto';
import { GetAdminCategoriesQueryDto } from './dto/category-query.dto';
import { GetAdminComplaintsQueryDto } from './dto/complaint-query.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { AdminStatsInterval, GetAdminStatsQueryDto } from './dto/stats-query.dto';
import { CreateAdminCategoryDto, UpdateAdminCategoryDto } from './dto/upsert-category.dto';
import { GetAdminUsersQueryDto } from './dto/user-query.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { GlobalAdminGuard } from './guards/global-admin.guard';

interface RequestWithAdmin extends Request {
  user: { adminId: number; email: string; role: AdminRole };
}

class AdminListItemResponseDto implements AdminListItemResponse {
  @ApiProperty()
  adminId: number;
  @ApiProperty()
  name: string;
  @ApiProperty()
  email: string;
  @ApiProperty({ enum: [AdminRole.ADMIN] })
  role: AdminRole.ADMIN;
  @ApiProperty()
  isActive: boolean;
  @ApiPropertyOptional({ nullable: true })
  inviteExpiresAt: Date | null;
  @ApiProperty()
  createdAt: Date;
}

class AdminsPageResponseDto implements OffsetPaginatedResponse<AdminListItemResponseDto> {
  @ApiProperty({ type: [AdminListItemResponseDto] })
  items: AdminListItemResponseDto[];
  @ApiProperty()
  total: number;
  @ApiProperty()
  offset: number;
  @ApiProperty()
  limit: number;
}

class AdminUserListItemResponseDto implements AdminUserListItemResponse {
  @ApiProperty()
  userId: number;
  @ApiProperty()
  name: string;
  @ApiProperty()
  username: string;
  @ApiProperty()
  email: string;
  @ApiProperty()
  createdAt: Date;
  @ApiPropertyOptional({ nullable: true })
  blockedAt: Date | null;
  @ApiProperty()
  postsCount: number;
  @ApiProperty()
  activeViolationsCount: number;
}

class AdminUsersPageResponseDto implements OffsetPaginatedResponse<AdminUserListItemResponseDto> {
  @ApiProperty({ type: [AdminUserListItemResponseDto] })
  items: AdminUserListItemResponseDto[];
  @ApiProperty()
  total: number;
  @ApiProperty()
  offset: number;
  @ApiProperty()
  limit: number;
}

class AdminUserViolationResponseDto implements AdminUserViolationResponse {
  @ApiProperty()
  complaintId: number;
  @ApiProperty({ enum: ComplaintReason, enumName: 'ComplaintReason' })
  complaintReason: ComplaintReason;
  @ApiProperty()
  complaintReasonLabel: string;
  @ApiProperty({ enum: ComplaintStatus, enumName: 'ComplaintStatus' })
  status: ComplaintStatus;
  @ApiProperty()
  createdAt: Date;
  @ApiPropertyOptional({ nullable: true })
  processedAt: Date | null;
  @ApiPropertyOptional({ nullable: true })
  expiresAt: Date | null;
  @ApiPropertyOptional({ nullable: true })
  adminId: number | null;
  @ApiProperty()
  postId: number;
  @ApiPropertyOptional({ nullable: true })
  postRemovedAt: Date | null;
  @ApiPropertyOptional({ nullable: true })
  postRestorationDeadline: Date | null;
}

class AdminUserDetailsResponseDto extends AdminUserListItemResponseDto implements AdminUserDetailsResponse {
  @ApiProperty({ type: [AdminUserViolationResponseDto] })
  violations: AdminUserViolationResponseDto[];
}

class AdminCategoryResponseDto implements AdminCategoryResponse {
  @ApiProperty()
  categoryId: number;
  @ApiProperty()
  categoryName: string;
  @ApiProperty()
  postsCount: number;
}

class AdminCategoriesPageResponseDto implements OffsetPaginatedResponse<AdminCategoryResponseDto> {
  @ApiProperty({ type: [AdminCategoryResponseDto] })
  items: AdminCategoryResponseDto[];
  @ApiProperty()
  total: number;
  @ApiProperty()
  offset: number;
  @ApiProperty()
  limit: number;
}

class AdminComplaintAuthorDto {
  @ApiProperty()
  userId: number;
  @ApiProperty()
  name: string;
  @ApiProperty()
  username: string;
  @ApiProperty()
  email: string;
}

class AdminComplaintTargetUserDto extends AdminComplaintAuthorDto {
  @ApiPropertyOptional({ nullable: true })
  blockedAt: Date | null;
}

class AdminComplaintTargetPostDto {
  @ApiProperty()
  postId: number;
  @ApiProperty()
  slug: string;
  @ApiPropertyOptional({ nullable: true })
  title: string | null;
  @ApiPropertyOptional({ nullable: true })
  removedAt: Date | null;
  @ApiPropertyOptional({ nullable: true })
  postRestorationDeadline: Date | null;
}

class AdminComplaintProcessedByAdminDto {
  @ApiProperty()
  adminId: number;
  @ApiProperty()
  name: string;
  @ApiProperty()
  email: string;
}

class AdminComplaintResponseDto implements AdminComplaintResponse {
  @ApiProperty()
  complaintId: number;
  @ApiProperty({ enum: ComplaintReason, enumName: 'ComplaintReason' })
  complaintReason: ComplaintReason;
  @ApiProperty()
  complaintReasonLabel: string;
  @ApiProperty({ enum: ComplaintStatus, enumName: 'ComplaintStatus' })
  status: ComplaintStatus;
  @ApiProperty()
  createdAt: Date;
  @ApiPropertyOptional({ nullable: true })
  processedAt: Date | null;
  @ApiPropertyOptional({ nullable: true })
  expiresAt: Date | null;
  @ApiProperty({ type: () => AdminComplaintAuthorDto })
  author: AdminComplaintAuthorDto;
  @ApiProperty({ type: () => AdminComplaintTargetUserDto })
  targetUser: AdminComplaintTargetUserDto;
  @ApiProperty({ type: () => AdminComplaintTargetPostDto })
  targetPost: AdminComplaintTargetPostDto;
  @ApiPropertyOptional({ type: () => AdminComplaintProcessedByAdminDto, nullable: true })
  processedByAdmin: AdminComplaintProcessedByAdminDto | null;
}

class AdminComplaintsPageResponseDto implements OffsetPaginatedResponse<AdminComplaintResponseDto> {
  @ApiProperty({ type: [AdminComplaintResponseDto] })
  items: AdminComplaintResponseDto[];
  @ApiProperty()
  total: number;
  @ApiProperty()
  offset: number;
  @ApiProperty()
  limit: number;
}

class AdminOverviewStatsResponseDto implements AdminOverviewStatsResponse {
  @ApiProperty()
  users: { total: number; active: number; blocked: number };
  @ApiProperty()
  posts: { total: number; published: number; removed: number };
  @ApiProperty()
  complaints: { total: number; pending: number; resolved: number; dismissed: number; cancelled: number };
}

class AdminStatsTimeseriesPointResponseDto implements AdminStatsTimeseriesPointResponse {
  @ApiProperty()
  bucketStart: string;
  @ApiProperty()
  users: { total: number; active: number; blocked: number };
  @ApiProperty()
  posts: { total: number; published: number; removed: number };
  @ApiProperty()
  complaints: { total: number; pending: number; resolved: number; dismissed: number; cancelled: number };
}

class AdminStatsTimeseriesResponseDto implements AdminStatsTimeseriesResponse {
  @ApiProperty({ enum: AdminStatsInterval, enumName: 'AdminStatsInterval' })
  interval: AdminStatsInterval;
  @ApiProperty()
  from: string;
  @ApiProperty()
  to: string;
  @ApiProperty({ type: [AdminStatsTimeseriesPointResponseDto] })
  items: AdminStatsTimeseriesPointResponseDto[];
}

@Controller('admin')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('admins')
  @UseGuards(GlobalAdminGuard)
  getAdmins(@Query() query: GetAdminsQueryDto): Promise<AdminsPageResponseDto> {
    return this.adminService.listAdmins(query);
  }

  @Post('admins/invite')
  @UseGuards(GlobalAdminGuard)
  inviteAdmin(@Body() dto: InviteAdminDto): Promise<{ ok: true }> {
    return this.adminService.inviteAdmin(dto);
  }

  @Delete('admins/:adminId')
  @UseGuards(GlobalAdminGuard)
  deleteAdmin(@Param('adminId', ParseIntPipe) adminId: number): Promise<{ ok: true }> {
    return this.adminService.deleteAdmin(adminId);
  }

  @Get('users')
  getUsers(@Query() query: GetAdminUsersQueryDto): Promise<AdminUsersPageResponseDto> {
    return this.adminService.listUsers(query);
  }

  @Get('users/:userId')
  getUserDetails(@Param('userId', ParseIntPipe) userId: number): Promise<AdminUserDetailsResponseDto> {
    return this.adminService.getUserDetails(userId);
  }

  @Post('users/:userId/block')
  blockUser(@Param('userId', ParseIntPipe) userId: number): Promise<{ ok: true }> {
    return this.adminService.blockUser(userId);
  }

  @Post('users/:userId/unblock')
  unblockUser(@Param('userId', ParseIntPipe) userId: number): Promise<{ ok: true }> {
    return this.adminService.unblockUser(userId);
  }

  @Delete('users/:userId/violations/:complaintId')
  removeViolation(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('complaintId', ParseIntPipe) complaintId: number,
  ): Promise<{ ok: true; userBlocked: boolean }> {
    return this.adminService.removeViolation(userId, complaintId);
  }

  @Get('categories')
  getCategories(@Query() query: GetAdminCategoriesQueryDto): Promise<AdminCategoriesPageResponseDto> {
    return this.adminService.listCategories(query);
  }

  @Post('categories')
  createCategory(@Body() dto: CreateAdminCategoryDto): Promise<AdminCategoryResponseDto> {
    return this.adminService.createCategory(dto);
  }

  @Patch('categories/:categoryId')
  updateCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() dto: UpdateAdminCategoryDto,
  ): Promise<AdminCategoryResponseDto> {
    return this.adminService.updateCategory(categoryId, dto);
  }

  @Delete('categories/:categoryId')
  deleteCategory(@Param('categoryId', ParseIntPipe) categoryId: number): Promise<{ ok: true }> {
    return this.adminService.deleteCategory(categoryId);
  }

  @Get('complaints')
  getComplaints(@Query() query: GetAdminComplaintsQueryDto): Promise<AdminComplaintsPageResponseDto> {
    return this.adminService.listComplaints(query);
  }

  @Post('complaints/:complaintId/accept')
  acceptComplaint(
    @Req() req: RequestWithAdmin,
    @Param('complaintId', ParseIntPipe) complaintId: number,
  ): Promise<AdminComplaintResponseDto> {
    return this.adminService.acceptComplaint(complaintId, req.user.adminId);
  }

  @Post('complaints/:complaintId/decline')
  dismissComplaint(
    @Req() req: RequestWithAdmin,
    @Param('complaintId', ParseIntPipe) complaintId: number,
  ): Promise<AdminComplaintResponseDto> {
    return this.adminService.dismissComplaint(complaintId, req.user.adminId);
  }

  @Get('stats/overview')
  getOverviewStats(): Promise<AdminOverviewStatsResponseDto> {
    return this.adminService.getOverviewStats();
  }

  @Get('stats/timeseries')
  getTimeseries(@Query() query: GetAdminStatsQueryDto): Promise<AdminStatsTimeseriesResponseDto> {
    return this.adminService.getTimeseries(query);
  }
}
