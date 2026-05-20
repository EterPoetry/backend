import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'browser_push_subscriptions' })
export class BrowserPushSubscription {
  @PrimaryGeneratedColumn({ name: 'browser_push_subscription_id' })
  browserPushSubscriptionId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @Column({ name: 'endpoint', type: 'varchar', length: 1000, unique: true })
  endpoint: string;

  @Column({ name: 'p256dh_key', type: 'varchar', length: 255 })
  p256dhKey: string;

  @Column({ name: 'auth_key', type: 'varchar', length: 255 })
  authKey: string;

  @Column({ name: 'expiration_time', type: 'timestamptz', nullable: true })
  expirationTime: Date | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 1000, nullable: true })
  userAgent: string | null;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ name: 'last_failure_at', type: 'timestamptz', nullable: true })
  lastFailureAt: Date | null;

  @Column({ name: 'last_failure_status_code', type: 'integer', nullable: true })
  lastFailureStatusCode: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
