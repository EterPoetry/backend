import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './entities/post.entity';
import { PopularPostSnapshot } from './entities/popular-post-snapshot.entity';
import { PopularPostSnapshotItem } from './entities/popular-post-snapshot-item.entity';
import { PostTextPart } from './entities/post-text-part.entity';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
import { PostListenSession } from './entities/post-listen-session.entity';
import { StorageModule } from '../storage/storage.module';
import { CategoriesModule } from '../categories/categories.module';
import { CommentsModule } from '../comments/comments.module';
import { UsersModule } from '../users/users.module';
import { PublicConfigModule } from '../public-config/public-config.module';
import { PostReaction } from '../reactions/entities/post-reaction.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostAudioStorageService } from './post-audio-storage.service';
import { PostAudioTranscodingService } from './post-audio-transcoding.service';
import { PostAudioProcessingQueueService } from './post-audio-processing-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post,
      PopularPostSnapshot,
      PopularPostSnapshotItem,
      PostTextPart,
      PostAudioProcessingJob,
      PostListenSession,
      PostReaction,
    ]),
    StorageModule,
    CategoriesModule,
    CommentsModule,
    UsersModule,
    PublicConfigModule,
  ],
  controllers: [PostsController],
  providers: [
    PostsService,
    PostAudioStorageService,
    PostAudioTranscodingService,
    PostAudioProcessingQueueService,
  ],
  exports: [TypeOrmModule, PostsService],
})
export class PostsModule {}
