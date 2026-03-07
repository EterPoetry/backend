import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostReaction } from './entities/post-reaction.entity';
import { CommentReaction } from './entities/comment-reaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PostReaction, CommentReaction])],
  exports: [TypeOrmModule],
})
export class ReactionsModule {}
