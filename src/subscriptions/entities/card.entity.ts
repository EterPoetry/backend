import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity({ name: 'cards' })
@Unique('UQ_cards_token', ['token'])
@Unique('UQ_cards_subscription_id', ['subscriptionId'])
export class Card {
  @PrimaryGeneratedColumn({ name: 'card_id' })
  cardId: number;

  @Column({ name: 'token', type: 'varchar', length: 255 })
  token: string;

  @Column({ name: 'payment_system', type: 'varchar', length: 30 })
  paymentSystem: string;

  @Column({ name: 'masked_number', type: 'varchar', length: 30 })
  maskedNumber: string;

  @OneToOne(() => Subscription, (subscription) => subscription.card, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'subscription_id', type: 'integer' })
  subscriptionId: number;
}
