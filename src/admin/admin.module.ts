import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { PostCategory } from '../categories/entities/post-category.entity';
import { PostComplaint } from '../complaints/entities/post-complaint.entity';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { GlobalAdminGuard } from './guards/global-admin.guard';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { Admin } from './entities/admin.entity';
import { AdminRefreshToken } from './entities/admin-refresh-token.entity';

@Module({
  imports: [
    ConfigModule,
    MailModule,
    NotificationsModule,
    UsersModule,
    TypeOrmModule.forFeature([
      Admin,
      AdminRefreshToken,
      User,
      Post,
      Category,
      PostCategory,
      PostComplaint,
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('ADMIN_JWT_ACCESS_SECRET', 'dev-admin-access-secret'),
        signOptions: {
          expiresIn: configService.get<string>('ADMIN_JWT_ACCESS_TTL', '15m'),
        },
      }),
    }),
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    GlobalAdminGuard,
  ],
  exports: [TypeOrmModule, AdminAuthService, AdminService],
})
export class AdminModule {}
