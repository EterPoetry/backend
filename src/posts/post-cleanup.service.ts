import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Post } from './entities/post.entity';
import { PostAudioStorageService } from './post-audio-storage.service';

const REMOVAL_CLEANUP_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PostCleanupService implements OnModuleInit {
  private readonly logger = new Logger(PostCleanupService.name);

  constructor(
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    private readonly postAudioStorageService: PostAudioStorageService,
  ) {}

  onModuleInit() {
    void this.runCleanup();
    setInterval(() => void this.runCleanup(), CLEANUP_INTERVAL_MS);
  }

  private async runCleanup(): Promise<void> {
    const threshold = new Date(Date.now() - REMOVAL_CLEANUP_DAYS * 24 * 60 * 60 * 1000);

    const posts = await this.postsRepository.find({
      where: { removedAt: LessThan(threshold) },
      select: {
        postId: true,
        audioFileName: true,
        sourceAudioFileName: true,
      },
    });

    if (posts.length === 0) {
      return;
    }

    for (const post of posts) {
      try {
        await this.postsRepository.update(post.postId, {
          title: null,
          description: null,
          text: null,
          originAuthorName: null,
          audioFileName: null,
          sourceAudioFileName: null,
          audioDurationSeconds: null,
        });
        await this.postAudioStorageService.deleteAudio(post.audioFileName);
        await this.postAudioStorageService.deleteAudio(post.sourceAudioFileName);
      } catch (error) {
        this.logger.error(`Failed to clean up removed post ${post.postId}`, error);
      }
    }

    this.logger.log(`Cleaned up content for ${posts.length} removed post(s).`);
  }
}
