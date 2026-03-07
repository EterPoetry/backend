import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PostComplaint } from '../../complaints/entities/post-complaint.entity';

@Entity({ name: 'admins' })
export class Admin {
  @PrimaryGeneratedColumn({ name: 'admin_id' })
  adminId: number;

  @Column({ name: 'name', type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'email', type: 'varchar', length: 320, unique: true })
  email: string;

  @Column({ name: 'password', type: 'varchar', length: 255 })
  password: string;

  @Column({ name: 'is_global_admin', type: 'boolean', default: false })
  isGlobalAdmin: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => PostComplaint, (complaint) => complaint.admin)
  processedComplaints: PostComplaint[];
}
