import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Post } from '../../posts/entities/post.entity';
import { PostComment } from '../../comments/entities/post-comment.entity';
import { PostComplaint } from '../../complaints/entities/post-complaint.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationType } from '../notification-type.enum';

@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn({ name: 'notification_id' })
  notificationId: number;

  @ManyToOne(() => User, (user) => user.notifications, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_user_id' })
  recipientUser: User;

  @Column({ name: 'recipient_user_id', type: 'integer' })
  recipientUserId: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'last_actor_user_id' })
  lastActor: User | null;

  @Column({ name: 'last_actor_user_id', type: 'integer', nullable: true })
  lastActorUserId: number | null;

  @ManyToOne(() => Post, (post) => post.notifications, { onDelete: 'CASCADE', nullable: true })
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

  @Column({ name: 'notification_type', type: 'varchar', length: 64 })
  notificationType: NotificationType;

  @Column({ name: 'group_key', type: 'varchar', length: 255, unique: true })
  groupKey: string;

  @Column({ name: 'events_count', type: 'integer', default: 1 })
  eventsCount: number;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'is_seen', type: 'boolean', default: false })
  isSeen: boolean;

  @Column({ name: 'bucket_start', type: 'timestamptz' })
  bucketStart: Date;

  @Column({ name: 'bucket_size_minutes', type: 'integer', default: 60 })
  bucketSizeMinutes: number;

  @Column({ name: 'last_event_at', type: 'timestamptz' })
  lastEventAt: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'seen_at', type: 'timestamptz', nullable: true })
  seenAt: Date | null;

  @Column({ name: 'preview_text', type: 'text', nullable: true })
  previewText: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
