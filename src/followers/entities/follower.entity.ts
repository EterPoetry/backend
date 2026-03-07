import { CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Unique, Column } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'followers' })
@Unique('UQ_followers_follower_target', ['followerUserId', 'targetUserId'])
export class Follower {
  @PrimaryGeneratedColumn({ name: 'follower_id' })
  followerId: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.following, { onDelete: 'CASCADE' })
  followerUser: User;

  @Column({ name: 'follower_user_id', type: 'integer' })
  followerUserId: number;

  @ManyToOne(() => User, (user) => user.followers, { onDelete: 'CASCADE' })
  targetUser: User;

  @Column({ name: 'target_user_id', type: 'integer' })
  targetUserId: number;
}
