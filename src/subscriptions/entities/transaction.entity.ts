import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';
import { TransactionStatus } from '../../common/enums/transaction-status.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';

@Entity({ name: 'transactions' })
export class Transaction {
  @PrimaryGeneratedColumn({ name: 'transaction_id' })
  transactionId: number;

  @ManyToOne(() => Subscription, (subscription) => subscription.transactions, {
    onDelete: 'CASCADE',
  })
  subscription: Subscription;

  @Column({ name: 'subscription_id', type: 'integer' })
  subscriptionId: number;

  @Column({ name: 'invoice_id', type: 'varchar', length: 120, unique: true })
  invoiceId: string;

  @Column({ name: 'status', type: 'enum', enum: TransactionStatus })
  status: TransactionStatus;

  @Column({ name: 'type', type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ name: 'sum', type: 'numeric', precision: 10, scale: 2 })
  sum: string;

  @Column({ name: 'currency', type: 'varchar', length: 10 })
  currency: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
