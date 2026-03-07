import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Post } from '../../posts/entities/post.entity';
import { Admin } from '../../admin/entities/admin.entity';
import { ComplaintStatus } from '../../common/enums/complaint-status.enum';

@Entity({ name: 'post_complaints' })
export class PostComplaint {
  @PrimaryGeneratedColumn({ name: 'post_complaint_id' })
  postComplaintId: number;

  @ManyToOne(() => User, (user) => user.authoredComplaints, { onDelete: 'CASCADE' })
  author: User;

  @Column({ name: 'author_id', type: 'integer' })
  authorId: number;

  @ManyToOne(() => User, (user) => user.receivedComplaints, { onDelete: 'CASCADE' })
  targetUser: User;

  @Column({ name: 'target_user_id', type: 'integer' })
  targetUserId: number;

  @ManyToOne(() => Post, (post) => post.complaints, { onDelete: 'CASCADE' })
  targetPost: Post;

  @Column({ name: 'target_post_id', type: 'integer' })
  targetPostId: number;

  @Column({ name: 'complaint_reason', type: 'text' })
  complaintReason: string;

  @Column({ name: 'status', type: 'enum', enum: ComplaintStatus })
  status: ComplaintStatus;

  @ManyToOne(() => Admin, (admin) => admin.processedComplaints, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  admin: Admin | null;

  @Column({ name: 'admin_id', type: 'integer', nullable: true })
  adminId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
}
