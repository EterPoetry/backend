import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { SitemapService } from './sitemap.service';

@Controller()
@ApiExcludeController()
export class SitemapController {
  constructor(private readonly sitemapService: SitemapService) {}

  @Get('sitemap.xml')
  async getSitemapIndex(@Res() res: Response): Promise<void> {
    const xml = await this.sitemapService.generateSitemapIndex();
    res
      .set('Content-Type', 'application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=300, s-maxage=300')
      .send(xml);
  }

  @Get('sitemaps/recent-posts.xml')
  async getRecentPostsSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.sitemapService.generateRecentPostsSitemap();
    res
      .set('Content-Type', 'application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=300, s-maxage=300')
      .send(xml);
  }

  @Get('sitemaps/posts-:shard.xml')
  async getPostsSitemap(@Param('shard') shard: string, @Res() res: Response): Promise<void> {
    const xml = await this.sitemapService.generatePostsSitemap(Number(shard));
    res
      .set('Content-Type', 'application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=86400, s-maxage=86400')
      .send(xml);
  }

  @Get('sitemaps/users-:shard.xml')
  async getUsersSitemap(@Param('shard') shard: string, @Res() res: Response): Promise<void> {
    const xml = await this.sitemapService.generateUsersSitemap(Number(shard));
    res
      .set('Content-Type', 'application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=86400, s-maxage=86400')
      .send(xml);
  }
}
