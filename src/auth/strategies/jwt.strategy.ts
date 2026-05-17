import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export interface JwtAccessPayload {
  sub: number;
  email?: string;
  type: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<{ userId: number; email?: string }> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type.');
    }

    const user = await this.usersRepository.findOne({
      where: { userId: payload.sub },
      select: { userId: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return { userId: user.userId, email: user.email ?? payload.email };
  }
}
