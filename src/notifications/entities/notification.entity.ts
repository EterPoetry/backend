import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Post } from '../../posts/entities/post.entity';

@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn({ name: 'notification_id' })
  notificationId: number;

  @Column({ name: 'notification_text', type: 'text' })
  notificationText: string;

  @Column({ name: 'notification_type', type: 'varchar', length: 100 })
  notificationType: string;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.notifications, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => Post, (post) => post.notifications, { onDelete: 'CASCADE' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;
}
