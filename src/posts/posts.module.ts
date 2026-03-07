import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './entities/post.entity';
import { PostTextPart } from './entities/post-text-part.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Post, PostTextPart])],
  exports: [TypeOrmModule],
})
export class PostsModule {}
