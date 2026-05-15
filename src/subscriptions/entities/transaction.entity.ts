import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
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
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'subscription_id', type: 'integer' })
  subscriptionId: number;

  @Column({ name: 'invoice_id', type: 'varchar', length: 120, unique: true })
  invoiceId: string;

  @Column({ name: 'status', type: 'enum', enum: TransactionStatus, nullable: true })
  status: TransactionStatus | null;

  @Column({ name: 'type', type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ name: 'sum', type: 'numeric', precision: 10, scale: 2 })
  sum: string;

  @Column({ name: 'amount', type: 'numeric', precision: 10, scale: 2, nullable: true })
  amount: string | null;

  @Column({ name: 'currency', type: 'varchar', length: 10 })
  currency: string;

  @Column({ name: 'modified_date', type: 'timestamptz', nullable: true })
  modifiedDate: Date | null;

  @Column({ name: 'is_card_updating', type: 'boolean', default: false })
  isCardUpdating: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
