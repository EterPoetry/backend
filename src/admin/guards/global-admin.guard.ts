import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AdminRole } from '../admin-role.enum';

interface AdminRequestUser {
  adminId: number;
  email: string;
  role: AdminRole;
}

@Injectable()
export class GlobalAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AdminRequestUser }>();
    const admin = request.user;

    if (!admin || admin.role !== AdminRole.GLOBAL_ADMIN) {
      throw new ForbiddenException('Global admin access is required.');
    }

    return true;
  }
}
