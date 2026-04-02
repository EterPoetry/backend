import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { type CookieOptions, Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleMobileLoginDto } from './dto/google-mobile-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

interface RequestWithUser extends Request {
  user: { userId: number; email?: string };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  @Redirect()
  @ApiTags('Google Auth')
  googleAuth(): { url: string } {
    return { url: this.authService.getGoogleAuthUrl() };
  }

  @Get('google/callback')
  @ApiTags('Google Auth')
  async googleCallback(
    @Query('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const authResponse = await this.authService.googleCallback(code);
    this.setRefreshCookie(res, authResponse.refreshToken);
    const redirectUrl = this.authService.getGoogleFrontendRedirectUrl(authResponse);
    if (redirectUrl) {
      res.redirect(302, redirectUrl);
      return;
    }
    const { refreshToken, ...response } = authResponse;
    res.status(200).json(response);
  }

  @Post('google/mobile')
  @HttpCode(200)
  @ApiTags('Google Auth')
  async googleMobileLogin(
    @Body() dto: GoogleMobileLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const authData = await this.authService.googleMobileLogin(dto.idToken);
    this.setRefreshCookie(res, authData.refreshToken);
    const { refreshToken, ...response } = authData;
    return response;
  }

  @Post('register')
  @ApiTags('Authentication')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const authData = await this.authService.register(dto);
    this.setRefreshCookie(res, authData.refreshToken);
    const { refreshToken, ...response } = authData;
    return response;
  }

  @Post('login')
  @HttpCode(200)
  @ApiTags('Authentication')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const authData = await this.authService.login(dto);
    this.setRefreshCookie(res, authData.refreshToken);
    const { refreshToken, ...response } = authData;
    return response;
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiTags('Authentication')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const token = req.cookies?.refreshToken;
    if (!token) {
      throw new UnauthorizedException();
    }

    const authData = await this.authService.refresh(token);

    this.setRefreshCookie(res, authData.refreshToken);

    const { refreshToken, ...response } = authData;
    return response;
  }

  @Post('logout')
  @HttpCode(200)
  @ApiTags('Authentication')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.authService.logout(req.cookies?.refreshToken);
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie('refreshToken', refreshToken, {
      ...this.getRefreshCookieBaseOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('refreshToken', this.getRefreshCookieBaseOptions());
  }

  private getRefreshCookieBaseOptions(): CookieOptions {
    const secure =
      this.getBooleanEnv('REFRESH_COOKIE_SECURE') ?? process.env.NODE_ENV === 'production';
    const sameSite = this.getRefreshCookieSameSite(secure);
    const domain = process.env.REFRESH_COOKIE_DOMAIN?.trim();

    return {
      httpOnly: true,
      secure,
      sameSite,
      ...(domain ? { domain } : {}),
      path: '/',
    };
  }

  private getRefreshCookieSameSite(secure: boolean): CookieOptions['sameSite'] {
    const configuredValue = process.env.REFRESH_COOKIE_SAME_SITE?.trim().toLowerCase();

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
      'REFRESH_COOKIE_SAME_SITE must be one of: lax, strict, none.',
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

  private getClientIp(req: Request): string | null {
    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0];
    const clientIp = forwardedIp?.trim() || req.ip || req.socket.remoteAddress;
    return clientIp ? clientIp.slice(0, 64) : null;
  }

  @Post('password/forgot')
  @HttpCode(200)
  @ApiTags('Password Recovery')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request): Promise<{ ok: true }> {
    await this.authService.requestPasswordReset(dto.email, this.getClientIp(req));
    return { ok: true };
  }

  @Post('password/reset')
  @HttpCode(200)
  @ApiTags('Password Recovery')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Post('email/verify/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiTags('Email Verification')
  @ApiBearerAuth()
  async requestEmailVerification(@Req() req: RequestWithUser): Promise<{ ok: true }> {
    await this.authService.requestEmailVerification(req.user.userId, this.getClientIp(req));
    return { ok: true };
  }

  @Get('email/verify/request')
  @UseGuards(JwtAuthGuard)
  @ApiTags('Email Verification')
  @ApiBearerAuth()
  async getEmailVerificationRequestStatus(
    @Req() req: RequestWithUser,
  ): Promise<{ remainingMs: number | null }> {
    return this.authService.getEmailVerificationRequestStatus(req.user.userId);
  }

  @Post('email/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiTags('Email Verification')
  @ApiBearerAuth()
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ ok: true }> {
    await this.authService.verifyEmail(dto.email, dto.code);
    return { ok: true };
  }
}
