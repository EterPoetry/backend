import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { PostComment } from '../../comments/entities/post-comment.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'comment_reactions' })
@Unique('UQ_comment_reactions_comment_user', ['postCommentId', 'userId'])
export class CommentReaction {
  @PrimaryGeneratedColumn({ name: 'comment_reaction_id' })
  commentReactionId: number;

  @ManyToOne(() => PostComment, (postComment) => postComment.reactions, {
    onDelete: 'CASCADE',
  })
  postComment: PostComment;

  @Column({ name: 'post_comment_id', type: 'integer' })
  postCommentId: number;

  @ManyToOne(() => User, (user) => user.commentReactions, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;
}
