import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PostTextPart } from './post-text-part.entity';
import { PostCategory } from '../../categories/entities/post-category.entity';
import { PostReaction } from '../../reactions/entities/post-reaction.entity';
import { PostComment } from '../../comments/entities/post-comment.entity';
import { PostComplaint } from '../../complaints/entities/post-complaint.entity';
import { Notification } from '../../notifications/entities/notification.entity';
import { PostStatus } from '../../common/enums/post-status.enum';

@Entity({ name: 'posts' })
export class Post {
  @PrimaryGeneratedColumn({ name: 'post_id' })
  postId: number;

  @Column({ name: 'title', type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'text', type: 'text', nullable: true })
  text: string | null;

  @Column({ name: 'audio_file_name', type: 'varchar', length: 300, nullable: true })
  audioFileName: string | null;

  @Column({ name: 'source_audio_file_name', type: 'varchar', length: 300, nullable: true })
  sourceAudioFileName: string | null;

  @Column({ name: 'listens', type: 'integer', default: 0 })
  listens: number;

  @Column({ name: 'origin_author_name', type: 'varchar', length: 200, nullable: true })
  originAuthorName: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: PostStatus,
    default: PostStatus.DRAFT,
  })
  status: PostStatus;

  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ name: 'author_id', type: 'integer' })
  authorId: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => PostTextPart, (textPart) => textPart.post)
  textParts: PostTextPart[];

  @OneToMany(() => PostCategory, (postCategory) => postCategory.post)
  postCategories: PostCategory[];

  @OneToMany(() => PostReaction, (reaction) => reaction.post)
  postReactions: PostReaction[];

  @OneToMany(() => PostComment, (comment) => comment.post)
  comments: PostComment[];

  @OneToMany(() => PostComplaint, (complaint) => complaint.targetPost)
  complaints: PostComplaint[];

  @OneToMany(() => Notification, (notification) => notification.post)
  notifications: Notification[];
}
