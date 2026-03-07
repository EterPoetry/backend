import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Post } from '../../posts/entities/post.entity';
import { User } from '../../users/entities/user.entity';
import { CommentReaction } from '../../reactions/entities/comment-reaction.entity';

@Entity({ name: 'post_comments' })
export class PostComment {
  @PrimaryGeneratedColumn({ name: 'post_comment_id' })
  postCommentId: number;

  @ManyToOne(() => Post, (post) => post.comments, { onDelete: 'CASCADE' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @ManyToOne(() => User, (user) => user.postComments, { onDelete: 'CASCADE' })
  commentAuthor: User;

  @Column({ name: 'comment_author_id', type: 'integer' })
  commentAuthorId: number;

  @Column({ name: 'comment_text', type: 'text' })
  commentText: string;

  @ManyToOne(() => PostComment, (comment) => comment.replies, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  replyToComment: PostComment | null;

  @Column({ name: 'reply_to_comment_id', type: 'integer', nullable: true })
  replyToCommentId: number | null;

  @OneToMany(() => PostComment, (comment) => comment.replyToComment)
  replies: PostComment[];

  @OneToMany(() => CommentReaction, (reaction) => reaction.postComment)
  reactions: CommentReaction[];
}
