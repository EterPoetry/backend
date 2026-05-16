import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { SitemapCache } from './sitemap.cache';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';

@Module({
  imports: [TypeOrmModule.forFeature([Post, User])],
  controllers: [SitemapController],
  providers: [SitemapCache, SitemapService],
})
export class SitemapModule {}
