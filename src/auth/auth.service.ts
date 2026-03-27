import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { promisify } from 'util';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { RateLimitedMailService } from '../mail/rate-limited-mail.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const scrypt = promisify(_scrypt);
const SCRYPT_KEYLEN = 64;
const DEFAULT_ACCESS_TTL = '15m';
const DEFAULT_REFRESH_TTL = '30d';
const DEFAULT_PASSWORD_RESET_TTL = '1h';
const DEFAULT_PASSWORD_RESET_REQUEST_COOLDOWN = '10m';
const DEFAULT_EMAIL_VERIFICATION_TTL = '24h';
const DEFAULT_EMAIL_VERIFICATION_REQUEST_COOLDOWN = '10m';

export type SafeUser = Omit<
  User,
  | 'password'
  | 'verificationCode'
  | 'verificationCodeSentDate'
  | 'refreshTokens'
  | 'resetPasswordTokenHash'
  | 'resetPasswordExpiresAt'
  | 'passwordResetRequestedAt'
>;

export interface AuthResponse {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

interface JwtPayload {
  sub: number;
  email?: string;
  type: 'access' | 'refresh';
  jti?: string;
}

interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: RateLimitedMailService,
  ) {}

  getGoogleAuthUrl(): string {
    const client = this.getGoogleClient();
    const scopes = ['openid', 'email', 'profile'];

    return client.generateAuthUrl({
      scope: scopes,
      include_granted_scopes: true,
      prompt: 'consent',
    });
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existingUser = await this.usersRepository.findOne({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = this.usersRepository.create({
      name: dto.name,
      email: dto.email,
      password: passwordHash,
      photo: null,
      isEmailVerified: false,
      verificationCode: null,
      verificationCodeSentDate: null,
      passwordResetRequestedAt: null,
    });

    const savedUser = await this.usersRepository.save(user);
    return this.issueAuthResponse(savedUser);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (!user.password) {
      throw new UnauthorizedException('Password login is unavailable for this account.');
    }

    const isPasswordValid = await this.verifyPassword(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = this.hashRefreshToken(refreshToken);

    const storedToken = await this.refreshTokensRepository.findOne({
      where: {
        userId: payload.sub,
        tokenHash,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    storedToken.revokedAt = new Date();
    await this.refreshTokensRepository.save(storedToken);

    const user = await this.usersRepository.findOne({
      where: { userId: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return this.issueAuthResponse(user);
  }

  async requestPasswordReset(email: string, ipAddress: string | null): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user) {
      return;
    }

    const now = Date.now();
    const cooldownMs = this.getPasswordResetRequestCooldownMs();

    if (user.passwordResetRequestedAt) {
      const elapsedMs = now - user.passwordResetRequestedAt.getTime();
      if (elapsedMs < cooldownMs) {
        return;
      }
    }

    await this.mailService.sendPasswordResetEmail(ipAddress, async () => {
      const token = this.generatePasswordResetToken();
      user.resetPasswordTokenHash = this.hashPasswordResetToken(token);
      user.resetPasswordExpiresAt = this.getPasswordResetExpiryDate();
      user.passwordResetRequestedAt = new Date(now);
      await this.usersRepository.save(user);

      return {
        recipient: { email: user.email, name: user.name },
        resetUrl: this.buildPasswordResetUrl(token),
      };
    });
  }
  async requestEmailVerification(userId: number, ipAddress: string | null): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { userId },
    });

    if (!user) {
      return;
    }

    if (user.isEmailVerified) {
      throw new ConflictException('Email is already verified.');
    }

    if (user.verificationCodeSentDate) {
      const cooldownMs = this.getEmailVerificationRequestCooldownMs();
      const elapsedMs = Date.now() - user.verificationCodeSentDate.getTime();

      if (elapsedMs < cooldownMs) {
        const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / (60 * 1000));
        throw new HttpException(
          'Verification email was sent recently. Please wait ' +
            waitMinutes +
            ' minute' +
            (waitMinutes === 1 ? '' : 's') +
            ' before requesting another.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.mailService.sendEmailVerificationEmail(ipAddress, async () => {
      const code = this.generateEmailVerificationCode();
      user.verificationCode = code;
      user.verificationCodeSentDate = new Date();
      await this.usersRepository.save(user);

      return {
        recipient: { email: user.email, name: user.name },
        verificationUrl: this.buildEmailVerificationUrl(user.email, code),
      };
    });
  }

  async getEmailVerificationRequestStatus(
    userId: number,
  ): Promise<{ remainingMs: number | null }> {
    const user = await this.usersRepository.findOne({
      where: { userId },
    });

    if (!user || user.isEmailVerified || !user.verificationCodeSentDate) {
      return { remainingMs: null };
    }

    const cooldownMs = this.getEmailVerificationRequestCooldownMs();
    const elapsedMs = Date.now() - user.verificationCodeSentDate.getTime();

    if (elapsedMs >= cooldownMs) {
      return { remainingMs: null };
    }

    return { remainingMs: cooldownMs - elapsedMs };
  }


  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token) {
      throw new BadRequestException('Reset token is required.');
    }

    const tokenHash = this.hashPasswordResetToken(token);
    const user = await this.usersRepository.findOne({
      where: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: MoreThan(new Date()),
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    if (user.password) {
      const isSamePassword = await this.verifyPassword(newPassword, user.password);
      if (isSamePassword) {
        throw new BadRequestException('New password must differ from the old password.');
      }
    }

    user.password = await this.hashPassword(newPassword);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;
    user.passwordResetRequestedAt = null;
    await this.usersRepository.save(user);

    await this.refreshTokensRepository.update(
      { userId: user.userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async verifyEmail(email: string, code: string): Promise<void> {
    if (!email || !code) {
      throw new BadRequestException('Email and code are required.');
    }

    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user || !user.verificationCode) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    if (!user.verificationCodeSentDate) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    if (!this.isEmailVerificationCodeValid(user.verificationCodeSentDate)) {
      throw new UnauthorizedException('Verification code has expired.');
    }

    const codeMatches = this.safeCompare(user.verificationCode, code);
    if (!codeMatches) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    user.isEmailVerified = true;
    user.verificationCode = null;
    user.verificationCodeSentDate = null;
    await this.usersRepository.save(user);
  }

  async googleCallback(code: string): Promise<AuthResponse> {
    if (!code) {
      throw new BadRequestException('Missing authorization code.');
    }

    const client = this.getGoogleClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new UnauthorizedException('Google token exchange failed.');
    }

    return this.googleLoginWithIdToken(tokens.id_token);
  }

  getGoogleFrontendRedirectUrl(authResponse: AuthResponse): string | null {
    const frontendUrl = this.configService.get<string>('FRONTEND_AUTH_REDIRECT_URL');
    if (!frontendUrl) {
      return null;
    }

    let url: URL;
    try {
      url = new URL(frontendUrl);
    } catch {
      throw new ServiceUnavailableException('Frontend auth redirect URL is invalid.');
    }

    url.searchParams.set('accessToken', authResponse.accessToken);
    return url.toString();
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) {
      return false;
    }

    const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
    const storedKey = Buffer.from(hash, 'hex');
    if (storedKey.length !== derivedKey.length) {
      return false;
    }

    return timingSafeEqual(storedKey, derivedKey);
  }

  private async issueAuthResponse(user: User): Promise<AuthResponse> {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user);
    await this.storeRefreshToken(user.userId, refreshToken);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  private async signAccessToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.userId,
      email: user.email,
      type: 'access',
    };

    return this.jwtService.signAsync(payload, {
      secret: this.getAccessSecret(),
      expiresIn: this.getAccessTtl(),
    });
  }

  private async signRefreshToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.userId,
      type: 'refresh',
      jti: randomBytes(16).toString('hex'),
    };

    return this.jwtService.signAsync(payload, {
      secret: this.getRefreshSecret(),
      expiresIn: this.getRefreshTtl(),
    });
  }

  private async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.getRefreshSecret(),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token.');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }
  }

  private async storeRefreshToken(userId: number, refreshToken: string): Promise<void> {
    const expiresAt = this.getRefreshExpiryDate();
    const token = this.refreshTokensRepository.create({
      userId,
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt,
      revokedAt: null,
    });

    await this.refreshTokensRepository.save(token);
  }

  private hashRefreshToken(refreshToken: string): string {
    const secret = this.getRefreshHashSecret();
    return createHmac('sha256', secret).update(refreshToken).digest('hex');
  }

  private getRefreshExpiryDate(): Date {
    const ttl = this.getRefreshTtl();
    const fallbackMs = this.parseDurationToMs(
      DEFAULT_REFRESH_TTL,
      30 * 24 * 60 * 60 * 1000,
    );
    const ttlMs = this.parseDurationToMs(ttl, fallbackMs);
    return new Date(Date.now() + ttlMs);
  }

  private parseDurationToMs(value: string, fallbackMs: number): number {
    const trimmed = value.trim();
    const match = /^(\d+)([smhd])$/.exec(trimmed);
    const numeric = Number(match ? match[1] : trimmed);

    if (Number.isNaN(numeric) || numeric <= 0) {
      return fallbackMs;
    }

    const unit = match?.[2] ?? 's';
    switch (unit) {
      case 's':
        return numeric * 1000;
      case 'm':
        return numeric * 60 * 1000;
      case 'h':
        return numeric * 60 * 60 * 1000;
      case 'd':
        return numeric * 24 * 60 * 60 * 1000;
      default:
        return fallbackMs;
    }
  }

  private getAccessSecret(): string {
    return this.configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');
  }

  private getRefreshSecret(): string {
    return this.configService.get<string>('JWT_REFRESH_SECRET', 'dev-refresh-secret');
  }

  private getRefreshHashSecret(): string {
    return this.configService.get<string>('JWT_REFRESH_HASH_SECRET', this.getRefreshSecret());
  }

  private getAccessTtl(): string {
    return this.configService.get<string>('JWT_ACCESS_TTL', DEFAULT_ACCESS_TTL);
  }

  private getRefreshTtl(): string {
    return this.configService.get<string>('JWT_REFRESH_TTL', DEFAULT_REFRESH_TTL);
  }

  private generatePasswordResetToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashPasswordResetToken(token: string): string {
    const secret = this.getPasswordResetTokenSecret();
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  private getPasswordResetExpiryDate(): Date {
    const ttl = this.getPasswordResetTtl();
    const fallbackMs = this.parseDurationToMs(
      DEFAULT_PASSWORD_RESET_TTL,
      60 * 60 * 1000,
    );
    const ttlMs = this.parseDurationToMs(ttl, fallbackMs);
    return new Date(Date.now() + ttlMs);
  }

  private getPasswordResetTtl(): string {
    return this.configService.get<string>('PASSWORD_RESET_TTL', DEFAULT_PASSWORD_RESET_TTL);
  }

  private getPasswordResetTokenSecret(): string {
    return this.configService.get<string>(
      'PASSWORD_RESET_TOKEN_SECRET',
      this.getRefreshSecret(),
    );
  }

  private buildPasswordResetUrl(token: string): string {
    const directUrl = this.configService.get<string>('PASSWORD_RESET_URL');
    const baseUrl = directUrl ?? this.configService.get<string>('APP_BASE_URL', '');
    const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';
    const resetBase = directUrl ? directUrl : `${normalizedBase}/reset-password`;
    const separator = resetBase.includes('?') ? '&' : '?';
    return `${resetBase}${separator}token=${encodeURIComponent(token)}`;
  }

  private generateEmailVerificationCode(): string {
    return randomBytes(16).toString('hex');
  }

  private buildEmailVerificationUrl(email: string, code: string): string {
    const directUrl = this.configService.get<string>('EMAIL_VERIFICATION_URL');
    const baseUrl = directUrl ?? this.configService.get<string>('APP_BASE_URL', '');
    const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';
    const verifyBase = directUrl ? directUrl : `${normalizedBase}/verify-email`;
    const separator = verifyBase.includes('?') ? '&' : '?';
    return `${verifyBase}${separator}email=${encodeURIComponent(
      email,
    )}&code=${encodeURIComponent(code)}`;
  }

  private isEmailVerificationCodeValid(sentAt: Date): boolean {
    const ttl = this.getEmailVerificationTtl();
    const fallbackMs = this.parseDurationToMs(
      DEFAULT_EMAIL_VERIFICATION_TTL,
      24 * 60 * 60 * 1000,
    );
    const ttlMs = this.parseDurationToMs(ttl, fallbackMs);
    return Date.now() - sentAt.getTime() <= ttlMs;
  }

  private getEmailVerificationTtl(): string {
    return this.configService.get<string>(
      'EMAIL_VERIFICATION_TTL',
      DEFAULT_EMAIL_VERIFICATION_TTL,
    );
  }

  private getPasswordResetRequestCooldownMs(): number {
    const fallbackMs = this.parseDurationToMs(
      DEFAULT_PASSWORD_RESET_REQUEST_COOLDOWN,
      10 * 60 * 1000,
    );
    const cooldown = this.configService.get<string>(
      'PASSWORD_RESET_REQUEST_COOLDOWN',
      DEFAULT_PASSWORD_RESET_REQUEST_COOLDOWN,
    );
    return this.parseDurationToMs(cooldown, fallbackMs);
  }

  private getEmailVerificationRequestCooldownMs(): number {
    const fallbackMs = this.parseDurationToMs(
      DEFAULT_EMAIL_VERIFICATION_REQUEST_COOLDOWN,
      10 * 60 * 1000,
    );
    const cooldown = this.configService.get<string>(
      'EMAIL_VERIFICATION_REQUEST_COOLDOWN',
      DEFAULT_EMAIL_VERIFICATION_REQUEST_COOLDOWN,
    );
    return this.parseDurationToMs(cooldown, fallbackMs);
  }

  private safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }
  private getGoogleClient(): OAuth2Client {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException('Google auth is not configured.');
    }

    return new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  private async googleLoginWithIdToken(idToken: string): Promise<AuthResponse> {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new ServiceUnavailableException('Google auth is not configured.');
    }

    const client = this.getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload() as GoogleProfile | undefined;

    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid Google profile.');
    }

    const emailFilter = payload.email ? [{ email: payload.email }] : [];
    let user = await this.usersRepository.findOne({
      where: [{ googleId: payload.sub }, ...emailFilter],
    });

    if (!user) {
      const fallbackName = payload.name || payload.email?.split('@')[0] || 'User';

      user = this.usersRepository.create({
        name: fallbackName.slice(0, 120),
        email: payload.email ?? `${payload.sub}@google.local`,
        password: null,
        googleId: payload.sub,
        photo: payload.picture ?? null,
        isEmailVerified: payload.email_verified ?? false,
        verificationCode: null,
        verificationCodeSentDate: null,
        passwordResetRequestedAt: null,
      });

      user = await this.usersRepository.save(user);
      return this.issueAuthResponse(user);
    }

    if (!user.googleId) {
      user.googleId = payload.sub;
    }

    if (payload.email && user.email !== payload.email) {
      user.email = payload.email;
    }

    if (payload.email_verified) {
      user.isEmailVerified = true;
    }

    if (payload.picture && !user.photo) {
      user.photo = payload.picture;
    }

    if (payload.name && !user.name) {
      user.name = payload.name;
    }

    user = await this.usersRepository.save(user);
    return this.issueAuthResponse(user);
  }


  private sanitizeUser(user: User): SafeUser {
    const {
      password,
      verificationCode,
      verificationCodeSentDate,
      refreshTokens,
      passwordResetRequestedAt,
      ...safeUser
    } = user;
    return safeUser;
  }
}
