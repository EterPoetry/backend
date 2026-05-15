import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EXPIRED_TRANSACTIONS_INTERVAL_MS } from './payments.constants';
import { PaymentsService } from './payments.service';

@Injectable()
export class ExpiredTransactionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiredTransactionsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly paymentsService: PaymentsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.run();
    }, EXPIRED_TRANSACTIONS_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    try {
      await this.paymentsService.markExpiredTransactions();
    } catch (error) {
      this.logger.error('Failed to mark expired transactions.', error as Error);
    }
  }
}
