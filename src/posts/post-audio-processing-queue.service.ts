import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PostAudioProcessingJobStatus } from '../common/enums/post-audio-processing-job-status.enum';
import { Post } from './entities/post.entity';
import { PostAudioProcessingJob } from './entities/post-audio-processing-job.entity';
import { PostAudioStorageService } from './post-audio-storage.service';
import { PostAudioTranscodingService } from './post-audio-transcoding.service';
import { PostsService } from './posts.service';

interface ClaimedJobRow {
  jobId: number | string;
  postId: number | string;
  sourceAudioFileName: string;
  attemptCount: number | string;
  jobid?: number | string;
  postid?: number | string;
  sourceaudiofilename?: string;
  attemptcount?: number | string;
  post_audio_processing_job_id?: number | string;
  post_id?: number | string;
  source_audio_file_name?: string;
  attempt_count?: number | string;
}

interface ClaimedJob {
  jobId: number;
  postId: number;
  sourceAudioFileName: string;
  attemptCount: number;
}

@Injectable()
export class PostAudioProcessingQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostAudioProcessingQueueService.name);
  private readonly maxConcurrency: number;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private activeWorkers = 0;
  private isDraining = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(PostAudioProcessingJob)
    private readonly postAudioProcessingJobsRepository: Repository<PostAudioProcessingJob>,
    private readonly postsService: PostsService,
    private readonly postAudioStorageService: PostAudioStorageService,
    private readonly postAudioTranscodingService: PostAudioTranscodingService,
  ) {
    this.maxConcurrency = this.getPositiveIntegerConfig('POST_AUDIO_PROCESSING_CONCURRENCY', 2);
    this.pollIntervalMs = this.getPositiveIntegerConfig('POST_AUDIO_PROCESSING_POLL_MS', 5000);
    this.maxAttempts = this.getPositiveIntegerConfig('POST_AUDIO_PROCESSING_MAX_ATTEMPTS', 5);
  }

  async onModuleInit(): Promise<void> {
    await this.requeueStaleJobs();
    this.pollTimer = setInterval(() => {
      void this.drainQueue();
    }, this.pollIntervalMs);
    void this.drainQueue();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async enqueueExistingPendingJobs(): Promise<void> {
    await this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.isDraining) {
      return;
    }

    this.isDraining = true;

    try {
      while (this.activeWorkers < this.maxConcurrency) {
        const job = await this.claimNextJob();
        if (!job) {
          break;
        }

        this.activeWorkers += 1;
        void this.processJob(job).finally(() => {
          this.activeWorkers -= 1;
          void this.drainQueue();
        });
      }
    } finally {
      this.isDraining = false;
    }
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    let post: Post | null = null;
    let processedAudioFileName: string | null = null;

    try {
      post = await this.postsService.getPostById(job.postId);
      if (!post) {
        await this.markJobCompleted(job.jobId);
        await this.postAudioStorageService.deleteAudio(job.sourceAudioFileName);
        return;
      }

      const sourceAudio = await this.postAudioStorageService.readAudio(job.sourceAudioFileName);
      const transcodedAudio = await this.postAudioTranscodingService.convertToOpus(sourceAudio);
      processedAudioFileName = await this.postAudioStorageService.saveProcessedAudio(
        post.authorId,
        transcodedAudio,
      );

      const previousSourceAudioFileName = await this.postsService.markPostProcessingCompleted(
        post,
        processedAudioFileName,
      );
      await this.markJobCompleted(job.jobId);
      await this.deleteSourceAudioSafely(previousSourceAudioFileName, job.postId);
    } catch (error) {
      if (processedAudioFileName) {
        await this.postAudioStorageService.deleteAudio(processedAudioFileName);
      }

      await this.markJobFailure(job.jobId, job.attemptCount, error);
      this.logger.error(
        `Post audio processing failed for post ${job.postId}: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private async claimNextJob(): Promise<ClaimedJob | null> {
    const queryResult = await this.dataSource.query(
      `
        WITH next_job AS (
          SELECT post_audio_processing_job_id
          FROM post_audio_processing_jobs
          WHERE status = $1
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE post_audio_processing_jobs
        SET
          status = $2,
          locked_at = NOW(),
          attempt_count = attempt_count + 1,
          updated_at = NOW()
        WHERE post_audio_processing_job_id IN (
          SELECT post_audio_processing_job_id FROM next_job
        )
        RETURNING
          post_audio_processing_job_id AS "jobId",
          post_id AS "postId",
          source_audio_file_name AS "sourceAudioFileName",
          attempt_count AS "attemptCount"
      `,
      [PostAudioProcessingJobStatus.PENDING, PostAudioProcessingJobStatus.PROCESSING],
    );

    const row = this.extractClaimedJobRow(queryResult);
    if (!row) {
      return null;
    }

    const jobId = Number(
      row.jobId ?? row.jobid ?? row.post_audio_processing_job_id,
    );
    const postId = Number(
      row.postId ?? row.postid ?? row.post_id,
    );
    const attemptCount = Number(
      row.attemptCount ?? row.attemptcount ?? row.attempt_count,
    );
    const sourceAudioFileName =
      row.sourceAudioFileName ?? row.sourceaudiofilename ?? row.source_audio_file_name;

    if (!Number.isInteger(jobId) || jobId <= 0) {
      this.logger.error(`Claimed queue job without a valid job id: ${this.stringifyRow(row)}`);
      return null;
    }

    if (!Number.isInteger(postId) || postId <= 0) {
      this.logger.error(
        `Claimed queue job ${jobId} without a valid post id: ${this.stringifyRow(row)}`,
      );
      return null;
    }

    if (!sourceAudioFileName) {
      this.logger.error(
        `Claimed queue job ${jobId} without a source audio file name: ${this.stringifyRow(row)}`,
      );
      return null;
    }

    return {
      jobId,
      postId,
      sourceAudioFileName,
      attemptCount: Number.isInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1,
    };
  }

  private async requeueStaleJobs(): Promise<void> {
    await this.postAudioProcessingJobsRepository.update(
      { status: PostAudioProcessingJobStatus.PROCESSING },
      {
        status: PostAudioProcessingJobStatus.PENDING,
        lockedAt: null,
      },
    );
  }

  private async markJobCompleted(jobId: number): Promise<void> {
    this.assertValidJobId(jobId);
    await this.postAudioProcessingJobsRepository.update(jobId, {
      status: PostAudioProcessingJobStatus.COMPLETED,
      lockedAt: null,
      lastError: null,
    });
  }

  private async markJobFailure(jobId: number, attemptCount: number, error: unknown): Promise<void> {
    this.assertValidJobId(jobId);
    const finalStatus =
      attemptCount >= this.maxAttempts
        ? PostAudioProcessingJobStatus.FAILED
        : PostAudioProcessingJobStatus.PENDING;

    await this.postAudioProcessingJobsRepository.update(jobId, {
      status: finalStatus,
      lockedAt: null,
      lastError: this.getErrorMessage(error),
    });
  }

  private getPositiveIntegerConfig(key: string, defaultValue: number): number {
    const rawValue = this.configService.get<string>(key);
    const parsed = rawValue ? Number.parseInt(rawValue, 10) : defaultValue;

    return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown processing error.';
  }

  private async deleteSourceAudioSafely(audioKey: string | null, postId: number): Promise<void> {
    try {
      await this.postAudioStorageService.deleteAudio(audioKey);
    } catch (error) {
      this.logger.warn(
        `Processed post ${postId}, but failed to delete source audio: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private assertValidJobId(jobId: number): void {
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new Error('Invalid queue job id.');
    }
  }

  private stringifyRow(row: unknown): string {
    try {
      return JSON.stringify(row);
    } catch {
      return '[unserializable row]';
    }
  }

  private extractClaimedJobRow(queryResult: unknown): ClaimedJobRow | null {
    if (!Array.isArray(queryResult) || queryResult.length === 0) {
      return null;
    }

    const firstItem = queryResult[0];

    if (Array.isArray(firstItem)) {
      if (firstItem.length === 0) {
        return null;
      }

      return this.isClaimedJobRow(firstItem[0]) ? firstItem[0] : null;
    }

    return this.isClaimedJobRow(firstItem) ? firstItem : null;
  }

  private isClaimedJobRow(value: unknown): value is ClaimedJobRow {
    return typeof value === 'object' && value !== null;
  }
}
