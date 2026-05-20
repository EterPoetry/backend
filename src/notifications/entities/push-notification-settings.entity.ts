import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { NotificationType } from '../notification-type.enum';

@Entity({ name: 'push_notification_settings' })
export class PushNotificationSettings {
  @PrimaryGeneratedColumn({ name: 'push_notification_settings_id' })
  pushNotificationSettingsId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'integer', unique: true })
  userId: number;

  @Column({
    name: 'disabled_types',
    type: 'text',
    array: true,
    default: '{}',
  })
  disabledTypes: NotificationType[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
