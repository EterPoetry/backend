import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { UsernameService } from './username.service';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  providers: [UsernameService, UsersService],
  exports: [TypeOrmModule, UsernameService, UsersService],
})
export class UsersModule {}
