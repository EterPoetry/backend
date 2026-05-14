import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from './post.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'post_listen_sessions' })
export class PostListenSession {
  @PrimaryGeneratedColumn({ name: 'post_listen_session_id' })
  postListenSessionId: number;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'user_id', type: 'integer', nullable: true })
  userId: number | null;

  @Column({ name: 'guest_session_id', type: 'varchar', length: 120, nullable: true })
  guestSessionId: string | null;

  @Column({ name: 'fingerprint_hash', type: 'varchar', length: 64, nullable: true })
  fingerprintHash: string | null;

  @Column({ name: 'client_session_id', type: 'varchar', length: 120 })
  clientSessionId: string;

  @Column({ name: 'track_duration_ms', type: 'integer' })
  trackDurationMs: number;

  @Column({ name: 'listened_ms', type: 'integer', default: 0 })
  listenedMs: number;

  @Column({ name: 'max_position_ms', type: 'integer', default: 0 })
  maxPositionMs: number;

  @Column({ name: 'last_position_ms', type: 'integer', nullable: true })
  lastPositionMs: number | null;

  @Column({ name: 'last_progress_at', type: 'timestamptz', nullable: true })
  lastProgressAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'listen_counted_at', type: 'timestamptz', nullable: true })
  listenCountedAt: Date | null;

  @Column({ name: 'is_suspicious', type: 'boolean', default: false })
  isSuspicious: boolean;

  @Column({ name: 'suspicious_reason', type: 'varchar', length: 200, nullable: true })
  suspiciousReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
