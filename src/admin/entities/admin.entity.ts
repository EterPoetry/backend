import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PostComplaint } from '../../complaints/entities/post-complaint.entity';
import { AdminRole } from '../admin-role.enum';
import { AdminRefreshToken } from './admin-refresh-token.entity';

@Entity({ name: 'admins' })
export class Admin {
  @PrimaryGeneratedColumn({ name: 'admin_id' })
  adminId: number;

  @Column({ name: 'name', type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'email', type: 'varchar', length: 320, unique: true })
  email: string;

  @Column({ name: 'password', type: 'varchar', length: 255, nullable: true })
  password: string | null;

  @Column({
    name: 'role',
    type: 'enum',
    enum: AdminRole,
    default: AdminRole.ADMIN,
  })
  role: AdminRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'invite_token_hash', type: 'varchar', length: 64, nullable: true })
  inviteTokenHash: string | null;

  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true })
  inviteExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => PostComplaint, (complaint) => complaint.admin)
  processedComplaints: PostComplaint[];

  @OneToMany(() => AdminRefreshToken, (refreshToken) => refreshToken.admin)
  refreshTokens: AdminRefreshToken[];
}
