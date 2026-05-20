import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { AdminRole } from '../admin-role.enum';
import { Admin } from '../entities/admin.entity';

export interface AdminJwtAccessPayload {
  sub: number;
  email: string;
  role: AdminRole;
  type: 'access';
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(Admin)
    private readonly adminsRepository: Repository<Admin>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('ADMIN_JWT_ACCESS_SECRET', 'dev-admin-access-secret'),
    });
  }

  async validate(
    payload: AdminJwtAccessPayload,
  ): Promise<{ adminId: number; email: string; role: AdminRole }> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type.');
    }

    const admin = await this.adminsRepository.findOne({
      where: {
        adminId: payload.sub,
        isActive: true,
      },
      select: {
        adminId: true,
        email: true,
        role: true,
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found.');
    }

    return {
      adminId: admin.adminId,
      email: admin.email,
      role: admin.role,
    };
  }
}
