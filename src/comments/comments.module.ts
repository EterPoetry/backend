import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/entities/post.entity';
import { CommentReaction } from '../reactions/entities/comment-reaction.entity';
import { StorageModule } from '../storage/storage.module';
import { PopularCommentSnapshot } from './entities/popular-comment-snapshot.entity';
import { PopularCommentSnapshotItem } from './entities/popular-comment-snapshot-item.entity';
import { PostComment } from './entities/post-comment.entity';
import { CommentsService } from './comments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PostComment,
      CommentReaction,
      Post,
      PopularCommentSnapshot,
      PopularCommentSnapshotItem,
    ]),
    StorageModule,
  ],
  providers: [CommentsService],
  exports: [TypeOrmModule, CommentsService],
})
export class CommentsModule {}
