import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { RateLimitedMailService } from '../mail/rate-limited-mail.service';
import { AdminRole } from './admin-role.enum';
import { AcceptAdminInviteDto } from './dto/accept-admin-invite.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { AdminRefreshToken } from './entities/admin-refresh-token.entity';
import { Admin } from './entities/admin.entity';

const scrypt = promisify(_scrypt);
const SCRYPT_KEYLEN = 64;
const DEFAULT_ACCESS_TTL = '15m';
const DEFAULT_REFRESH_TTL = '30d';
const DEFAULT_INVITE_TTL_DAYS = 7;

export interface SafeAdmin {
  adminId: number;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  inviteExpiresAt: Date | null;
  createdAt: Date;
}

export interface AdminAuthResponse {
  admin: SafeAdmin;
  accessToken: string;
  refreshToken: string;
}

interface AdminJwtPayload {
  sub: number;
  email: string;
  role: AdminRole;
  type: 'access' | 'refresh';
}

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(Admin)
    private readonly adminsRepository: Repository<Admin>,
    @InjectRepository(AdminRefreshToken)
    private readonly adminRefreshTokensRepository: Repository<AdminRefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: RateLimitedMailService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminAuthResponse> {
    await this.deleteExpiredPendingInvites();

    const admin = await this.adminsRepository.findOne({
      where: { email: dto.email, isActive: true },
    });

    if (!admin || !admin.password) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isPasswordValid = await this.verifyPassword(dto.password, admin.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueAuthResponse(admin);
  }

  async refresh(refreshToken: string): Promise<AdminAuthResponse> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = this.hashRefreshToken(refreshToken);

    const storedToken = await this.adminRefreshTokensRepository.findOne({
      where: {
        adminId: payload.sub,
        tokenHash,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    storedToken.revokedAt = new Date();
    await this.adminRefreshTokensRepository.save(storedToken);

    const admin = await this.adminsRepository.findOne({
      where: {
        adminId: payload.sub,
        isActive: true,
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return this.issueAuthResponse(admin);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      const tokenHash = this.hashRefreshToken(refreshToken);

      await this.adminRefreshTokensRepository.update(
        {
          adminId: payload.sub,
          tokenHash,
          revokedAt: IsNull(),
        },
        { revokedAt: new Date() },
      );
    } catch {
      return;
    }
  }

  async acceptInvite(token: string, dto: AcceptAdminInviteDto): Promise<AdminAuthResponse> {
    await this.deleteExpiredPendingInvites();

    const inviteTokenHash = this.hashInviteToken(token);
    const admin = await this.adminsRepository.findOne({
      where: {
        inviteTokenHash,
        isActive: false,
      },
    });

    if (!admin || !admin.inviteExpiresAt || admin.inviteExpiresAt <= new Date()) {
      throw new BadRequestException('Invitation link is invalid or expired.');
    }

    const existingAdmin = await this.adminsRepository.findOne({
      where: { email: dto.email },
      select: { adminId: true },
    });

    if (existingAdmin && existingAdmin.adminId !== admin.adminId) {
      throw new ConflictException('Email is already in use.');
    }

    admin.name = dto.name;
    admin.email = dto.email;
    admin.password = await this.hashPassword(dto.password);
    admin.isActive = true;
    admin.inviteTokenHash = null;
    admin.inviteExpiresAt = null;
    await this.adminsRepository.save(admin);

    return this.issueAuthResponse(admin);
  }

  async getMyProfile(adminId: number): Promise<SafeAdmin> {
    const admin = await this.requireActiveAdmin(adminId);
    return this.toSafeAdmin(admin);
  }

  async updateMyProfile(adminId: number, dto: UpdateAdminProfileDto): Promise<SafeAdmin> {
    const admin = await this.requireActiveAdmin(adminId);

    if (dto.email && dto.email !== admin.email) {
      const existingAdmin = await this.adminsRepository.findOne({
        where: { email: dto.email },
        select: { adminId: true },
      });

      if (existingAdmin && existingAdmin.adminId !== adminId) {
        throw new ConflictException('Email is already in use.');
      }

      admin.email = dto.email;
    }

    if (dto.name !== undefined) {
      admin.name = dto.name;
    }

    if (dto.newPassword !== undefined) {
      if (!admin.password || !dto.currentPassword) {
        throw new BadRequestException('Current password is required.');
      }

      const isPasswordValid = await this.verifyPassword(dto.currentPassword, admin.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Current password is invalid.');
      }

      admin.password = await this.hashPassword(dto.newPassword);
      await this.adminRefreshTokensRepository.update(
        {
          adminId,
          revokedAt: IsNull(),
        },
        { revokedAt: new Date() },
      );
    }

    await this.adminsRepository.save(admin);
    return this.toSafeAdmin(admin);
  }

  async sendInvitationEmail(admin: Admin, inviteToken: string): Promise<void> {
    await this.mailService.sendAdminInvitationEmail(
      {
        email: admin.email,
        name: admin.name,
      },
      this.buildInviteUrl(inviteToken),
    );
  }

  buildInvite(adminEmail: string): Admin {
    return this.adminsRepository.create({
      name: adminEmail.slice(0, 120),
      email: adminEmail,
      password: null,
      role: AdminRole.ADMIN,
      isActive: false,
      inviteTokenHash: null,
      inviteExpiresAt: null,
    });
  }

  generateInviteToken(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('hex');
    return {
      token,
      tokenHash: this.hashInviteToken(token),
      expiresAt: new Date(Date.now() + DEFAULT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  async deleteExpiredPendingInvites(): Promise<void> {
    await this.adminsRepository
      .createQueryBuilder()
      .delete()
      .from(Admin)
      .where('is_active = false')
      .andWhere('invite_expires_at IS NOT NULL')
      .andWhere('invite_expires_at <= NOW()')
      .execute();
  }

  private async requireActiveAdmin(adminId: number): Promise<Admin> {
    const admin = await this.adminsRepository.findOne({
      where: {
        adminId,
        isActive: true,
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }

    return admin;
  }

  private async issueAuthResponse(admin: Admin): Promise<AdminAuthResponse> {
    const accessToken = await this.jwtService.signAsync(this.buildJwtPayload(admin, 'access'), {
      secret: this.configService.get<string>('ADMIN_JWT_ACCESS_SECRET', 'dev-admin-access-secret'),
      expiresIn: this.configService.get<string>('ADMIN_JWT_ACCESS_TTL', DEFAULT_ACCESS_TTL),
    });
    const refreshToken = await this.jwtService.signAsync(this.buildJwtPayload(admin, 'refresh'), {
      secret: this.configService.get<string>('ADMIN_JWT_REFRESH_SECRET', 'dev-admin-refresh-secret'),
      expiresIn: this.configService.get<string>('ADMIN_JWT_REFRESH_TTL', DEFAULT_REFRESH_TTL),
    });
    const refreshExpiresAt = this.getRefreshTokenExpiryDate();

    await this.adminRefreshTokensRepository.save(
      this.adminRefreshTokensRepository.create({
        adminId: admin.adminId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
        revokedAt: null,
      }),
    );

    return {
      admin: this.toSafeAdmin(admin),
      accessToken,
      refreshToken,
    };
  }

  private buildJwtPayload(admin: Admin, type: 'access' | 'refresh'): AdminJwtPayload {
    return {
      sub: admin.adminId,
      email: admin.email,
      role: admin.role,
      type,
    };
  }

  private async verifyRefreshToken(refreshToken: string): Promise<AdminJwtPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AdminJwtPayload>(refreshToken, {
        secret: this.configService.get<string>(
          'ADMIN_JWT_REFRESH_SECRET',
          'dev-admin-refresh-secret',
        ),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token.');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) {
      return false;
    }

    const storedKey = Buffer.from(key, 'hex');
    const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;

    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  }

  private hashRefreshToken(refreshToken: string): string {
    const secret = this.configService.get<string>(
      'ADMIN_JWT_REFRESH_HASH_SECRET',
      'dev-admin-refresh-hash-secret',
    );

    return createHmac('sha256', secret).update(refreshToken).digest('hex');
  }

  private hashInviteToken(token: string): string {
    const secret = this.configService.get<string>('ADMIN_INVITE_TOKEN_SECRET', 'dev-admin-invite-secret');
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  private getRefreshTokenExpiryDate(): Date {
    const ttl = this.configService.get<string>('ADMIN_JWT_REFRESH_TTL', DEFAULT_REFRESH_TTL);
    return new Date(Date.now() + this.parseDurationToMs(ttl));
  }

  private parseDurationToMs(value: string): number {
    const match = value.trim().match(/^(\d+)([smhd])$/i);
    if (!match) {
      return 30 * 24 * 60 * 60 * 1000;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return amount * (multipliers[unit] ?? multipliers.d);
  }

  private buildInviteUrl(token: string): string {
    const rawUrl =
      this.configService.get<string>('ADMIN_INVITE_URL') ??
      `${this.configService.get<string>('APP_BASE_URL', 'http://localhost:3000').replace(/\/$/, '')}/admin/invite`;
    const url = new URL(rawUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private toSafeAdmin(admin: Admin): SafeAdmin {
    return {
      adminId: admin.adminId,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: admin.isActive,
      inviteExpiresAt: admin.inviteExpiresAt,
      createdAt: admin.createdAt,
    };
  }
}
