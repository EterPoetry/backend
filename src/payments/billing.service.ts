import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BILLING_INTERVAL_MS } from './payments.constants';
import { PaymentsService } from './payments.service';

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly paymentsService: PaymentsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.run();
    }, BILLING_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    try {
      await this.paymentsService.runBillingCycle();
    } catch (error) {
      this.logger.error('Recurring billing cycle failed.', error as Error);
    }
  }
}
