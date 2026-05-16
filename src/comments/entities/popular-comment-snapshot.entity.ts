import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PopularCommentSnapshotItem } from './popular-comment-snapshot-item.entity';

@Entity({ name: 'popular_comment_snapshots' })
export class PopularCommentSnapshot {
  @PrimaryGeneratedColumn({ name: 'snapshot_id' })
  snapshotId: number;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @Column({ name: 'reply_to_comment_id', type: 'integer', nullable: true })
  replyToCommentId: number | null;

  @CreateDateColumn({ name: 'generated_at', type: 'timestamptz' })
  generatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'total_comments', type: 'integer' })
  totalComments: number;

  @OneToMany(() => PopularCommentSnapshotItem, (item) => item.snapshot)
  items: PopularCommentSnapshotItem[];
}
