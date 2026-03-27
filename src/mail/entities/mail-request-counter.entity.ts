import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type MailRequestCounterWindowType = 'hour' | 'week' | 'month';

@Entity({ name: 'mail_request_counters' })
@Unique('UQ_mail_request_counters_ip_window', ['ipAddress', 'windowType', 'windowStart'])
export class MailRequestCounter {
  @PrimaryGeneratedColumn({ name: 'mail_request_counter_id' })
  mailRequestCounterId: number;

  @Column({ name: 'ip_address', type: 'varchar', length: 64 })
  ipAddress: string;

  @Column({ name: 'window_type', type: 'varchar', length: 16 })
  windowType: MailRequestCounterWindowType;

  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart: Date;

  @Column({ name: 'requests_count', type: 'integer', default: 0 })
  requestsCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
