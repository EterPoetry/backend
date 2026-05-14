import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = { userId: number; email?: string }>(err: unknown, user: TUser): TUser | null {
    if (err) {
      return null;
    }

    return user ?? null;
  }
}
