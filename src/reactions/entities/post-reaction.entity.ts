import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Post } from '../../posts/entities/post.entity';
import { User } from '../../users/entities/user.entity';
import { ReactionType } from '../../common/enums/reaction-type.enum';

@Entity({ name: 'post_reactions' })
@Unique('UQ_post_reactions_post_user', ['postId', 'userId'])
export class PostReaction {
  @PrimaryGeneratedColumn({ name: 'post_reaction_id' })
  postReactionId: number;

  @Column({ name: 'reaction_type', type: 'enum', enum: ReactionType })
  reactionType: ReactionType;

  @ManyToOne(() => Post, (post) => post.postReactions, { onDelete: 'CASCADE' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @ManyToOne(() => User, (user) => user.postReactions, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;
}
