import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Post } from './post.entity';
import { PopularPostSnapshot } from './popular-post-snapshot.entity';

@Entity({ name: 'popular_post_snapshot_items' })
export class PopularPostSnapshotItem {
  @PrimaryGeneratedColumn({ name: 'snapshot_item_id' })
  snapshotItemId: number;

  @ManyToOne(() => PopularPostSnapshot, (snapshot) => snapshot.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: PopularPostSnapshot;

  @Column({ name: 'snapshot_id', type: 'integer' })
  snapshotId: number;

  @ManyToOne(() => Post, (post) => post.popularSnapshotItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @Column({ name: 'rank', type: 'integer' })
  rank: number;

  @Column({ name: 'score', type: 'double precision' })
  score: number;
}
