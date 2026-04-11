import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PostAudioProcessingJobStatus } from '../../common/enums/post-audio-processing-job-status.enum';
import { Post } from './post.entity';

@Entity({ name: 'post_audio_processing_jobs' })
@Unique('UQ_post_audio_processing_jobs_post_id', ['postId'])
export class PostAudioProcessingJob {
  @PrimaryGeneratedColumn({ name: 'post_audio_processing_job_id' })
  postAudioProcessingJobId: number;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: PostAudioProcessingJobStatus,
    default: PostAudioProcessingJobStatus.PENDING,
  })
  status: PostAudioProcessingJobStatus;

  @Column({ name: 'source_audio_file_name', type: 'varchar', length: 300 })
  sourceAudioFileName: string;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
