import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PopularPostSnapshotItem } from './popular-post-snapshot-item.entity';

@Entity({ name: 'popular_post_snapshots' })
export class PopularPostSnapshot {
  @PrimaryGeneratedColumn({ name: 'snapshot_id' })
  snapshotId: number;

  @CreateDateColumn({ name: 'generated_at', type: 'timestamptz' })
  generatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'total_posts', type: 'integer' })
  totalPosts: number;

  @OneToMany(() => PopularPostSnapshotItem, (item) => item.snapshot)
  items: PopularPostSnapshotItem[];
}
