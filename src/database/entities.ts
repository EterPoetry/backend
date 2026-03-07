import { User } from '../users/entities/user.entity';
import { Post } from '../posts/entities/post.entity';
import { PostTextPart } from '../posts/entities/post-text-part.entity';
import { Category } from '../categories/entities/category.entity';
import { PostCategory } from '../categories/entities/post-category.entity';
import { PostReaction } from '../reactions/entities/post-reaction.entity';
import { PostComment } from '../comments/entities/post-comment.entity';
import { CommentReaction } from '../reactions/entities/comment-reaction.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Card } from '../subscriptions/entities/card.entity';
import { Transaction } from '../subscriptions/entities/transaction.entity';
import { Admin } from '../admin/entities/admin.entity';
import { PostComplaint } from '../complaints/entities/post-complaint.entity';
import { Follower } from '../followers/entities/follower.entity';
import { Notification } from '../notifications/entities/notification.entity';

export const ENTITIES = [
  User,
  Post,
  PostTextPart,
  Category,
  PostCategory,
  PostReaction,
  PostComment,
  CommentReaction,
  Subscription,
  Card,
  Transaction,
  Admin,
  PostComplaint,
  Follower,
  Notification,
];
