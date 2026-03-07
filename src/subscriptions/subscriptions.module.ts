import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { Card } from './entities/card.entity';
import { Transaction } from './entities/transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, Card, Transaction])],
  exports: [TypeOrmModule],
})
export class SubscriptionsModule {}
