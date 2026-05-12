import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostComplaint } from '../complaints/entities/post-complaint.entity';
import { Follower } from '../followers/entities/follower.entity';
import { Post } from '../posts/entities/post.entity';
import { StorageModule } from '../storage/storage.module';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AvatarStorageService } from './avatar-storage.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Follower, Post, Subscription, PostComplaint]),
    StorageModule,
    UsersModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService, AvatarStorageService],
})
export class ProfileModule {}
