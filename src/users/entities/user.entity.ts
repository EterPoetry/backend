import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Post } from '../../posts/entities/post.entity';
import { PostReaction } from '../../reactions/entities/post-reaction.entity';
import { PostComment } from '../../comments/entities/post-comment.entity';
import { CommentReaction } from '../../reactions/entities/comment-reaction.entity';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { PostComplaint } from '../../complaints/entities/post-complaint.entity';
import { Follower } from '../../followers/entities/follower.entity';
import { Notification } from '../../notifications/entities/notification.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({ name: 'user_id' })
  userId: number;

  @Column({ name: 'name', type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'email', type: 'varchar', length: 320, unique: true })
  email: string;

  @Column({ name: 'password', type: 'varchar', length: 255 })
  password: string;

  @Column({ name: 'photo', type: 'varchar', length: 500, nullable: true })
  photo: string | null;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified: boolean;

  @Column({ name: 'verification_code', type: 'varchar', length: 32, nullable: true })
  verificationCode: string | null;

  @Column({
    name: 'verification_code_sent_date',
    type: 'timestamptz',
    nullable: true,
  })
  verificationCodeSentDate: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];

  @OneToMany(() => PostReaction, (reaction) => reaction.user)
  postReactions: PostReaction[];

  @OneToMany(() => PostComment, (comment) => comment.commentAuthor)
  postComments: PostComment[];

  @OneToMany(() => CommentReaction, (reaction) => reaction.user)
  commentReactions: CommentReaction[];

  @OneToOne(() => Subscription, (subscription) => subscription.user)
  subscription: Subscription;

  @OneToMany(() => PostComplaint, (complaint) => complaint.author)
  authoredComplaints: PostComplaint[];

  @OneToMany(() => PostComplaint, (complaint) => complaint.targetUser)
  receivedComplaints: PostComplaint[];

  @OneToMany(() => Follower, (follower) => follower.followerUser)
  following: Follower[];

  @OneToMany(() => Follower, (follower) => follower.targetUser)
  followers: Follower[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];
}
