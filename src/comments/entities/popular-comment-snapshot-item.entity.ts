import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PostComment } from './post-comment.entity';
import { PopularCommentSnapshot } from './popular-comment-snapshot.entity';

@Entity({ name: 'popular_comment_snapshot_items' })
export class PopularCommentSnapshotItem {
  @PrimaryGeneratedColumn({ name: 'snapshot_item_id' })
  snapshotItemId: number;

  @ManyToOne(() => PopularCommentSnapshot, (snapshot) => snapshot.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: PopularCommentSnapshot;

  @Column({ name: 'snapshot_id', type: 'integer' })
  snapshotId: number;

  @ManyToOne(() => PostComment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment: PostComment;

  @Column({ name: 'comment_id', type: 'integer' })
  commentId: number;

  @Column({ name: 'rank', type: 'integer' })
  rank: number;

  @Column({ name: 'likes_count', type: 'integer' })
  likesCount: number;
}
