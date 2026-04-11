import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './entities/post.entity';
import { PostTextPart } from './entities/post-text-part.entity';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
import { StorageModule } from '../storage/storage.module';
import { CategoriesModule } from '../categories/categories.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostAudioStorageService } from './post-audio-storage.service';
import { PostAudioTranscodingService } from './post-audio-transcoding.service';
import { PostAudioProcessingQueueService } from './post-audio-processing-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostTextPart, PostAudioProcessingJob]),
    StorageModule,
    CategoriesModule,
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
