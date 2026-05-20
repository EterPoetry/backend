import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PostComment } from '../../comments/entities/post-comment.entity';
import { PostComplaint } from '../../complaints/entities/post-complaint.entity';
import { Follower } from '../../followers/entities/follower.entity';
import { Post } from '../../posts/entities/post.entity';
import { PostReaction } from '../../reactions/entities/post-reaction.entity';
import { CommentReaction } from '../../reactions/entities/comment-reaction.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationType } from '../notification-type.enum';

@Entity({ name: 'notification_events' })
export class NotificationEvent {
  @PrimaryGeneratedColumn({ name: 'notification_event_id' })
  notificationEventId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_user_id' })
  recipientUser: User;

  @Column({ name: 'recipient_user_id', type: 'integer' })
  recipientUserId: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User | null;

  @Column({ name: 'actor_user_id', type: 'integer', nullable: true })
  actorUserId: number | null;

  @ManyToOne(() => Post, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'post_id' })
  post: Post | null;

  @Column({ name: 'post_id', type: 'integer', nullable: true })
  postId: number | null;

  @ManyToOne(() => PostComment, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'comment_id' })
  comment: PostComment | null;

  @Column({ name: 'comment_id', type: 'integer', nullable: true })
  commentId: number | null;

  @ManyToOne(() => PostComplaint, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'post_complaint_id' })
  postComplaint: PostComplaint | null;

  @Column({ name: 'post_complaint_id', type: 'integer', nullable: true })
  postComplaintId: number | null;

  @ManyToOne(() => PostReaction, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'source_post_reaction_id' })
  sourcePostReaction: PostReaction | null;

  @Column({ name: 'source_post_reaction_id', type: 'integer', nullable: true })
  sourcePostReactionId: number | null;

  @ManyToOne(() => CommentReaction, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'source_comment_reaction_id' })
  sourceCommentReaction: CommentReaction | null;

  @Column({ name: 'source_comment_reaction_id', type: 'integer', nullable: true })
  sourceCommentReactionId: number | null;

  @ManyToOne(() => Follower, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'source_follower_id' })
  sourceFollower: Follower | null;

  @Column({ name: 'source_follower_id', type: 'integer', nullable: true })
  sourceFollowerId: number | null;

  @ManyToOne(() => PostComment, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'source_post_comment_id' })
  sourcePostComment: PostComment | null;

  @Column({ name: 'source_post_comment_id', type: 'integer', nullable: true })
  sourcePostCommentId: number | null;

  @ManyToOne(() => PostComplaint, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'source_post_complaint_id' })
  sourcePostComplaint: PostComplaint | null;

  @Column({ name: 'source_post_complaint_id', type: 'integer', nullable: true })
  sourcePostComplaintId: number | null;

  @Column({ name: 'notification_type', type: 'varchar', length: 64 })
  notificationType: NotificationType;

  @Column({ name: 'group_key', type: 'varchar', length: 255 })
  groupKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
