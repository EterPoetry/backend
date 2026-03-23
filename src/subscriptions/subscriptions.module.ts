import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { Transaction } from './entities/transaction.entity';
import { Card } from './entities/card.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, Transaction, Card])],
  exports: [TypeOrmModule],
})
export class SubscriptionsModule {}
