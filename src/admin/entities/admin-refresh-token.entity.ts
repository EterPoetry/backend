import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Admin } from './admin.entity';

@Entity({ name: 'admin_refresh_tokens' })
export class AdminRefreshToken {
  @PrimaryGeneratedColumn({ name: 'admin_refresh_token_id' })
  adminRefreshTokenId: number;

  @ManyToOne(() => Admin, (admin) => admin.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: Admin;

  @Column({ name: 'admin_id', type: 'integer' })
  adminId: number;

  @Column({ name: 'token_hash', type: 'varchar', length: 128, unique: true })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
