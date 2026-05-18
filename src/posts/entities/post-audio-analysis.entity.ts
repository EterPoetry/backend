import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AudioAnalysisFeature } from '../audio-analysis.types';
import { Post } from './post.entity';

@Entity({ name: 'post_audio_analysis' })
export class PostAudioAnalysis {
  @PrimaryColumn({ name: 'post_id', type: 'integer' })
  postId: number;

  @OneToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({ name: 'version', type: 'smallint', default: 1 })
  version: number;

  @Column({ name: 'duration_ms', type: 'integer' })
  durationMs: number;

  @Column({ name: 'frame_ms', type: 'smallint' })
  frameMs: number;

  @Column({ name: 'features', type: 'text', array: true })
  features: AudioAnalysisFeature[];

  @Column({ name: 'frames', type: 'bytea' })
  frames: Buffer;

  @Column({ name: 'waveform', type: 'bytea' })
  waveform: Buffer;

  @Column({ name: 'accents', type: 'jsonb', default: () => "'[]'" })
  accents: Array<[number, number]>;

  @Column({ name: 'silences', type: 'jsonb', default: () => "'[]'" })
  silences: Array<[number, number]>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
