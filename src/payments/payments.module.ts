import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Transaction } from '../subscriptions/entities/transaction.entity';
import { Card } from '../subscriptions/entities/card.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsApiService } from './payments-api.service';
import { BillingService } from './billing.service';
import { ExpiredTransactionsService } from './expired-transactions.service';
import { PaymentsGateway } from './payments.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Transaction, Card]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
      }),
    }),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsApiService,
    BillingService,
    ExpiredTransactionsService,
    PaymentsGateway,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
