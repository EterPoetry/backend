import {
  Column,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SubscriptionStatus } from '../../common/enums/subscription-status.enum';
import { Transaction } from './transaction.entity';
import { Card } from './card.entity';

@Entity({ name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn({ name: 'subscription_id' })
  subscriptionId: number;

  @OneToOne(() => User, (user) => user.subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'integer', unique: true })
  userId: number;

  @Column({ name: 'status', type: 'enum', enum: SubscriptionStatus })
  status: SubscriptionStatus;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'next_payment_date', type: 'date', nullable: true })
  nextPaymentDate: string | null;

  @Column({ name: 'cancellation_date', type: 'date', nullable: true })
  cancellationDate: string | null;

  @Column({ name: 'wallet_id', type: 'varchar', length: 100, nullable: true })
  walletId: string | null;

  @OneToOne(() => Card, (card) => card.subscription)
  card: Card;

  @OneToMany(() => Transaction, (transaction) => transaction.subscription)
  transactions: Transaction[];
}
