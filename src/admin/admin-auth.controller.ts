import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { type CookieOptions, Request, Response } from 'express';
import { AdminRole } from './admin-role.enum';
import { AdminAuthService, AdminAuthResponse, SafeAdmin } from './admin-auth.service';
import { AcceptAdminInviteDto } from './dto/accept-admin-invite.dto';
import { AdminInviteTokenQueryDto } from './dto/admin-invite-token-query.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';

interface RequestWithAdmin extends Request {
  user: { adminId: number; email: string; role: AdminRole };
}

class AdminProfileResponseDto implements SafeAdmin {
  @ApiProperty()
  adminId: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: AdminRole, enumName: 'AdminRole' })
  role: AdminRole;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({ nullable: true })
  inviteExpiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

class AdminAuthResponseDto implements Omit<AdminAuthResponse, 'refreshToken'> {
  @ApiProperty({ type: () => AdminProfileResponseDto })
  admin: AdminProfileResponseDto;

  @ApiProperty()
  accessToken: string;
}

@Controller('admin/auth')
@ApiTags('Admin Auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const authData = await this.adminAuthService.login(dto);
    this.setRefreshCookie(res, authData.refreshToken);
    const { refreshToken, ...response } = authData;
    return response;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const token = req.cookies?.adminRefreshToken;
    if (!token) {
      throw new UnauthorizedException('Refresh token is missing.');
    }

    const authData = await this.adminAuthService.refresh(token);
    this.setRefreshCookie(res, authData.refreshToken);
    const { refreshToken, ...response } = authData;
    return response;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.adminAuthService.logout(req.cookies?.adminRefreshToken);
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  @Post('invite/accept')
  @HttpCode(200)
  async acceptInvite(
    @Query() query: AdminInviteTokenQueryDto,
    @Body() dto: AcceptAdminInviteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const authData = await this.adminAuthService.acceptInvite(query.token, dto);
    this.setRefreshCookie(res, authData.refreshToken);
    const { refreshToken, ...response } = authData;
    return response;
  }

  @Get('profile')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  async getProfile(@Req() req: RequestWithAdmin): Promise<AdminProfileResponseDto> {
    return this.adminAuthService.getMyProfile(req.user.adminId);
  }

  @Patch('profile')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  async updateProfile(
    @Req() req: RequestWithAdmin,
    @Body() dto: UpdateAdminProfileDto,
  ): Promise<AdminProfileResponseDto> {
    return this.adminAuthService.updateMyProfile(req.user.adminId, dto);
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie('adminRefreshToken', refreshToken, {
      ...this.getRefreshCookieBaseOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('adminRefreshToken', this.getRefreshCookieBaseOptions());
  }

  private getRefreshCookieBaseOptions(): CookieOptions {
    const secure =
      this.getBooleanEnv('ADMIN_REFRESH_COOKIE_SECURE') ??
      this.getBooleanEnv('REFRESH_COOKIE_SECURE') ??
      process.env.NODE_ENV === 'production';
    const sameSite = this.getRefreshCookieSameSite(secure);
    const domain =
      process.env.ADMIN_REFRESH_COOKIE_DOMAIN?.trim() || process.env.REFRESH_COOKIE_DOMAIN?.trim();

    return {
      httpOnly: true,
      secure,
      sameSite,
      ...(domain ? { domain } : {}),
      path: '/',
    };
  }

  private getRefreshCookieSameSite(secure: boolean): CookieOptions['sameSite'] {
    const configuredValue =
      process.env.ADMIN_REFRESH_COOKIE_SAME_SITE?.trim().toLowerCase() ??
      process.env.REFRESH_COOKIE_SAME_SITE?.trim().toLowerCase();

    if (!configuredValue) {
      return secure ? 'none' : 'lax';
    }

    if (
      configuredValue === 'lax' ||
      configuredValue === 'strict' ||
      configuredValue === 'none'
    ) {
      return configuredValue;
    }

    throw new UnauthorizedException(
      'ADMIN_REFRESH_COOKIE_SAME_SITE must be one of: lax, strict, none.',
    );
  }

  private getBooleanEnv(name: string): boolean | null {
    const value = process.env[name]?.trim().toLowerCase();

    if (!value) {
      return null;
    }

    if (value === 'true' || value === '1' || value === 'yes') {
      return true;
    }

    if (value === 'false' || value === '0' || value === 'no') {
      return false;
    }

    throw new UnauthorizedException(`${name} must be a boolean value.`);
  }
}
