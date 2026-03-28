import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Follower } from '../followers/entities/follower.entity';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { AvatarStorageService } from './avatar-storage.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Follower, Post])],
  controllers: [ProfileController],
  providers: [ProfileService, AvatarStorageService],
})
export class ProfileModule {}
