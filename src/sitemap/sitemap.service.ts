import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { PostStatus } from '../common/enums/post-status.enum';

@Injectable()
export class SitemapService {
  private readonly siteUrl: string;
  private readonly shardSize: number;
  private readonly recentPostsCount: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    this.siteUrl = configService.get<string>('PUBLIC_SITE_URL', 'https://eter.pp.ua').replace(/\/$/, '');
    this.shardSize = Number(configService.get<string>('SITEMAP_SHARD_SIZE', '50000'));
    this.recentPostsCount = Number(configService.get<string>('SITEMAP_RECENT_POSTS_COUNT', '5000'));
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async generateSitemapIndex(): Promise<string> {
    const [postShardStats, userShardStats, recentLastmod] = await Promise.all([
      this.getPostShardStats(),
      this.getUserShardStats(),
      this.getRecentPostsLastmod(),
    ]);

    const entries: string[] = [];

    entries.push(
      this.buildSitemapIndexEntry(
        `${this.siteUrl}/sitemaps/recent-posts.xml`,
        (recentLastmod ?? new Date()).toISOString(),
      ),
    );

    if (postShardStats.length === 0) {
      entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/posts-0.xml`, new Date().toISOString()));
    } else {
      for (const stat of postShardStats) {
        entries.push(
          this.buildSitemapIndexEntry(
            `${this.siteUrl}/sitemaps/posts-${Number(stat.shard_num)}.xml`,
            new Date(stat.max_updated).toISOString(),
          ),
        );
      }
    }

    if (userShardStats.length === 0) {
      entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/users-0.xml`, new Date().toISOString()));
    } else {
      for (const stat of userShardStats) {
        entries.push(
          this.buildSitemapIndexEntry(
            `${this.siteUrl}/sitemaps/users-${Number(stat.shard_num)}.xml`,
            new Date(stat.max_updated).toISOString(),
          ),
        );
      }
    }

    return this.wrapSitemapIndex(entries.join('\n'));
  }

  private async getPostShardStats(): Promise<Array<{ shard_num: string; max_updated: string }>> {
    return this.postRepository.query(
      `
      SELECT
        floor((rn - 1) / $1::int) AS shard_num,
        MAX(updated_at)            AS max_updated
      FROM (
        SELECT updated_at, ROW_NUMBER() OVER (ORDER BY post_id ASC) AS rn
        FROM posts
        WHERE status = $2
      ) sub
      GROUP BY shard_num
      ORDER BY shard_num
      `,
      [this.shardSize, PostStatus.PUBLISHED],
    );
  }

  private async getUserShardStats(): Promise<Array<{ shard_num: string; max_updated: string }>> {
    return this.userRepository.query(
      `
      SELECT
        floor((rn - 1) / $1::int) AS shard_num,
        MAX(created_at)            AS max_updated
      FROM (
        SELECT created_at, ROW_NUMBER() OVER (ORDER BY user_id ASC) AS rn
        FROM users
      ) sub
      GROUP BY shard_num
      ORDER BY shard_num
      `,
      [this.shardSize],
    );
  }

  private async getRecentPostsLastmod(): Promise<Date | null> {
    const rows: Array<{ max_updated: string | null }> = await this.postRepository.query(
      `
      SELECT MAX(updated_at) AS max_updated
      FROM (
        SELECT updated_at FROM posts WHERE status = $1 ORDER BY post_id DESC LIMIT $2
      ) sub
      `,
      [PostStatus.PUBLISHED, this.recentPostsCount],
    );
    const val = rows[0]?.max_updated;
    return val ? new Date(val) : null;
  }

  async generatePostsSitemap(shard: number): Promise<string> {
    if (!Number.isFinite(shard) || shard < 0) {
      return this.wrapUrlset([]);
    }

    const posts = await this.postRepository
      .createQueryBuilder('post')
      .select(['post.postId', 'post.updatedAt'])
      .where('post.status = :status', { status: PostStatus.PUBLISHED })
      .orderBy('post.postId', 'ASC')
      .skip(shard * this.shardSize)
      .take(this.shardSize)
      .getMany();

    const entries = posts.map((post) =>
      this.buildUrlEntry(
        `${this.siteUrl}/posts/${post.postId}`,
        post.updatedAt,
      ),
    );

    return this.wrapUrlset(entries);
  }

  async generateUsersSitemap(shard: number): Promise<string> {
    if (!Number.isFinite(shard) || shard < 0) {
      return this.wrapUrlset([]);
    }

    const users = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.userId', 'user.username', 'user.createdAt'])
      .orderBy('user.userId', 'ASC')
      .skip(shard * this.shardSize)
      .take(this.shardSize)
      .getMany();

    const entries = users.map((user) =>
      this.buildUrlEntry(
        `${this.siteUrl}/users/${this.escapeXml(user.username)}`,
        user.createdAt,
      ),
    );

    return this.wrapUrlset(entries);
  }

  async generateRecentPostsSitemap(): Promise<string> {
    const posts = await this.postRepository
      .createQueryBuilder('post')
      .select(['post.postId', 'post.updatedAt'])
      .where('post.status = :status', { status: PostStatus.PUBLISHED })
      .orderBy('post.postId', 'DESC')
      .take(this.recentPostsCount)
      .getMany();

    const entries = posts.map((post) =>
      this.buildUrlEntry(
        `${this.siteUrl}/posts/${post.postId}`,
        post.updatedAt,
      ),
    );

    return this.wrapUrlset(entries);
  }

  private buildSitemapIndexEntry(loc: string, lastmod: string): string {
    return `  <sitemap>\n    <loc>${this.escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </sitemap>`;
  }

  private buildUrlEntry(loc: string, lastmod: Date): string {
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod.toISOString()}</lastmod>\n  </url>`;
  }

  private wrapSitemapIndex(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${inner}\n</sitemapindex>`;
  }

  private wrapUrlset(entries: string[]): string {
    const inner = entries.length > 0 ? '\n' + entries.join('\n') + '\n' : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${inner}</urlset>`;
  }
}
