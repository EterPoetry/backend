import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, createVerify } from 'crypto';
import { DataSource, EntityManager, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Transaction } from '../subscriptions/entities/transaction.entity';
import { Card } from '../subscriptions/entities/card.entity';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { TransactionStatus } from '../common/enums/transaction-status.enum';
import { TransactionType } from '../common/enums/transaction-type.enum';
import { PaymentsApiService } from './payments-api.service';
import { PaymentsGateway } from './payments.gateway';
import {
  CARD_UPDATE_AMOUNT_UAH,
  CARD_UPDATE_AMOUNT_UAH_MINOR,
  CARD_UPDATE_CURRENCY_CODE,
  CARD_UPDATE_CURRENCY_NUMERIC,
  INVOICE_VALIDITY_SECONDS,
  PREMIUM_PRICE_AMOUNT_USD,
  PREMIUM_PRICE_AMOUNT_USD_MINOR,
  PREMIUM_PRICE_CURRENCY_CODE,
  PREMIUM_PRICE_CURRENCY_NUMERIC,
  PUBLIC_KEY_REFRESH_COOLDOWN_MS,
  SUBSCRIPTION_RETRY_COUNT,
} from './payments.constants';
import { InvoiceStatusDto } from './dto/invoice-status.dto';
import { GetSubscriptionTransactionsQueryDto } from './dto/get-subscription-transactions-query.dto';

export interface SubscriptionCardResponse {
  cardId: number;
  paymentSystem: string;
  maskedNumber: string;
}

export interface SubscriptionTransactionResponse {
  transactionId: number;
  invoiceId: string;
  status: TransactionStatus | null;
  type: TransactionType;
  amount: string;
  currency: string;
  isCardUpdating: boolean;
  modifiedDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionResponse {
  subscriptionId: number;
  userId: number;
  status: SubscriptionStatus;
  startDate: string | null;
  nextPaymentDate: string | null;
  cancellationDate: string | null;
  walletId: string | null;
  card: SubscriptionCardResponse | null;
}

export interface PaginatedTransactionsResponse {
  items: SubscriptionTransactionResponse[];
  total: number;
  offset: number;
}

interface NormalizedInvoiceStatus {
  invoiceId: string;
  status: string;
  amountMinor: number | null;
  currencyCode: string | null;
  createdDate?: string;
  modifiedDate: string;
  walletData?: InvoiceStatusDto['walletData'];
  paymentInfo?: InvoiceStatusDto['paymentInfo'];
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly pendingWebhooks = new Map<string, NormalizedInvoiceStatus>();
  private cachedPublicKey: string | null = null;
  private publicKeyFetchedAt = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly paymentsApiService: PaymentsApiService,
    private readonly paymentsGateway: PaymentsGateway,
    @InjectRepository(Subscription)
    private readonly subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.restoreIncompleteTransactions();
  }

  async checkoutSubscription(
    userId: number,
  ): Promise<{ invoiceId: string; checkoutUrl: string | null }> {
    const subscription = await this.getOrCreateSubscription(userId);
    if (subscription.status === SubscriptionStatus.ACTIVE) {
      throw new ConflictException('Subscription is already active.');
    }

    const invoicePayload = {
      amount: PREMIUM_PRICE_AMOUNT_USD_MINOR,
      ccy: PREMIUM_PRICE_CURRENCY_NUMERIC,
      paymentType: 'debit',
      validity: INVOICE_VALIDITY_SECONDS,
      webHookUrl: this.getPaymentsWebhookUrl(),
      saveCardData: { saveCard: true },
      walletId: subscription.walletId,
      metadata: {
        userId,
        subscriptionId: subscription.subscriptionId,
      },
    };

    const invoice = await this.paymentsApiService.createCheckoutInvoice(invoicePayload);
    const now = new Date(Date.now() - 1000);

    await this.transactionsRepository.save(
      this.transactionsRepository.create({
        subscriptionId: subscription.subscriptionId,
        invoiceId: invoice.invoiceId,
        status: null,
        type: TransactionType.CHARGE,
        sum: PREMIUM_PRICE_AMOUNT_USD,
        amount: PREMIUM_PRICE_AMOUNT_USD,
        currency: PREMIUM_PRICE_CURRENCY_CODE,
        modifiedDate: now,
        isCardUpdating: false,
      }),
    );

    await this.applyPendingWebhook(invoice.invoiceId);

    this.paymentsGateway.emitCheckoutCreated(userId, {
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
    });

    return {
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
    };
  }

  async getSubscription(userId: number): Promise<SubscriptionResponse | null> {
    const subscription = await this.subscriptionsRepository.findOne({
      where: { userId },
      relations: { card: true },
    });

    return subscription ? this.buildSubscriptionResponse(subscription) : null;
  }

  async cancelSubscription(userId: number): Promise<{ ok: true }> {
    const subscription = await this.subscriptionsRepository.findOne({
      where: { userId },
      relations: { card: true },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.PAST_DUE
    ) {
      throw new ForbiddenException('Only active or past-due subscriptions can be cancelled.');
    }

    if (subscription.card?.token) {
      try {
        await this.paymentsApiService.deleteCard(subscription.card.token);
      } catch (error) {
        this.logger.warn(`Failed to delete provider card during cancellation: ${subscription.card.token}`);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      if (subscription.card) {
        await manager.getRepository(Card).delete({ cardId: subscription.card.cardId });
      }

      await manager.getRepository(Subscription).update(subscription.subscriptionId, {
        status: SubscriptionStatus.CANCELLED,
        cancellationDate: this.toDateOnlyString(new Date()),
        startDate: null,
        nextPaymentDate: null,
      });
    });

    return { ok: true };
  }

  async getSubscriptionTransactions(
    userId: number,
    query: GetSubscriptionTransactionsQueryDto,
  ): Promise<PaginatedTransactionsResponse> {
    const subscription = await this.requireSubscription(userId);

    const [items, total] = await this.transactionsRepository.findAndCount({
      where: { subscriptionId: subscription.subscriptionId },
      order: { createdAt: 'DESC', transactionId: 'DESC' },
      skip: query.offset,
      take: query.limit,
    });

    return {
      items: items.map((item) => this.buildTransactionResponse(item)),
      total,
      offset: query.offset,
    };
  }

  async updateSubscriptionCard(
    userId: number,
  ): Promise<{ invoiceId: string; checkoutUrl: string | null }> {
    const subscription = await this.subscriptionsRepository.findOne({
      where: { userId },
      relations: { card: true },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    if (subscription.status !== SubscriptionStatus.ACTIVE || !subscription.card) {
      throw new ForbiddenException('Card update is available only for active subscriptions with a linked card.');
    }

    const invoice = await this.paymentsApiService.createCheckoutInvoice({
      amount: CARD_UPDATE_AMOUNT_UAH_MINOR,
      ccy: CARD_UPDATE_CURRENCY_NUMERIC,
      paymentType: 'hold',
      validity: INVOICE_VALIDITY_SECONDS,
      webHookUrl: this.getPaymentsWebhookUrl(),
      saveCardData: { saveCard: true },
      walletId: subscription.walletId,
      metadata: {
        userId,
        subscriptionId: subscription.subscriptionId,
        action: 'update_card',
      },
    });

    await this.transactionsRepository.save(
      this.transactionsRepository.create({
        subscriptionId: subscription.subscriptionId,
        invoiceId: invoice.invoiceId,
        status: TransactionStatus.CREATED,
        type: TransactionType.HOLD,
        sum: CARD_UPDATE_AMOUNT_UAH,
        amount: CARD_UPDATE_AMOUNT_UAH,
        currency: CARD_UPDATE_CURRENCY_CODE,
        modifiedDate: new Date(Date.now() - 1000),
        isCardUpdating: true,
      }),
    );

    await this.applyPendingWebhook(invoice.invoiceId);

    return {
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
    };
  }

  async handleWebhook(rawBody: Buffer | string | undefined, signature: string | undefined, dto: InvoiceStatusDto): Promise<{ ok: true }> {
    if (!rawBody || !signature) {
      throw new BadRequestException('Webhook signature headers or body are missing.');
    }

    const isValid = await this.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      const refreshedValid = await this.verifyWebhookSignature(rawBody, signature, true);
      if (!refreshedValid) {
        throw new ForbiddenException('Webhook signature is invalid.');
      }
    }

    const normalizedInvoice = this.normalizeInvoiceStatus(dto);
    const transaction = await this.transactionsRepository.findOne({
      where: [
        {
          invoiceId: normalizedInvoice.invoiceId,
          modifiedDate: IsNull(),
        },
        {
          invoiceId: normalizedInvoice.invoiceId,
          modifiedDate: LessThanOrEqual(new Date(normalizedInvoice.modifiedDate)),
        },
      ],
      order: { modifiedDate: 'DESC' },
    });

    if (!transaction) {
      this.pendingWebhooks.set(normalizedInvoice.invoiceId, normalizedInvoice);
      return { ok: true };
    }

    await this.processInvoiceStatus(transaction, normalizedInvoice);
    this.pendingWebhooks.delete(normalizedInvoice.invoiceId);
    return { ok: true };
  }

  async processInvoiceStatus(
    transaction: Transaction,
    dto: NormalizedInvoiceStatus,
  ): Promise<void> {
    const webhookModifiedDate = new Date(dto.modifiedDate);
    if (transaction.modifiedDate && transaction.modifiedDate > webhookModifiedDate) {
      return;
    }

    const normalizedStatus = this.mapProviderStatus(dto.status);
    const emissionResult = await this.dataSource.transaction(async (manager) => {
      const subscriptionsRepository = manager.getRepository(Subscription);
      const transactionsRepository = manager.getRepository(Transaction);

      const lockedTransaction = await transactionsRepository.findOne({
        where: { transactionId: transaction.transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedTransaction) {
        throw new NotFoundException('Transaction not found.');
      }

      if (lockedTransaction.modifiedDate && lockedTransaction.modifiedDate > webhookModifiedDate) {
        return null;
      }

      const subscription = await subscriptionsRepository.findOne({
        where: { subscriptionId: lockedTransaction.subscriptionId },
        relations: { card: true },
      });
      if (!subscription) {
        throw new NotFoundException('Subscription not found.');
      }

      let shouldEmitCardLinked = false;

      if (dto.walletData?.walletId && dto.walletData.walletId !== subscription.walletId) {
        await subscriptionsRepository.update(subscription.subscriptionId, {
          walletId: dto.walletData.walletId,
        });
        subscription.walletId = dto.walletData.walletId;
      }

      if (dto.walletData?.status?.toLowerCase() === 'created' && dto.walletData.cardToken) {
        await this.replaceSubscriptionCard(
          manager,
          subscription,
          dto.walletData.cardToken,
          dto.paymentInfo?.paymentSystem,
          dto.paymentInfo?.maskedPan,
        );
        shouldEmitCardLinked = true;
      }

      if (!lockedTransaction.isCardUpdating && normalizedStatus === TransactionStatus.SUCCESS) {
        const anchorDate = webhookModifiedDate;
        const startDate = subscription.startDate ?? this.toDateOnlyString(anchorDate);
        await subscriptionsRepository.update(subscription.subscriptionId, {
          status: SubscriptionStatus.ACTIVE,
          cancellationDate: null,
          startDate,
          nextPaymentDate: this.toDateOnlyString(this.addMonth(anchorDate)),
        });
      }

      if (!lockedTransaction.isCardUpdating && normalizedStatus === TransactionStatus.FAILURE) {
        const nextStatus = await this.resolveFailureSubscriptionStatus(
          manager,
          subscription,
          lockedTransaction.transactionId,
          lockedTransaction.status,
        );

        await subscriptionsRepository.update(subscription.subscriptionId, {
          status: nextStatus,
          cancellationDate:
            nextStatus === SubscriptionStatus.CANCELLED ? this.toDateOnlyString(new Date()) : null,
          nextPaymentDate:
            nextStatus === SubscriptionStatus.CANCELLED ? null : subscription.nextPaymentDate,
        });
      }

      await transactionsRepository.update(lockedTransaction.transactionId, {
        status: normalizedStatus,
        modifiedDate: webhookModifiedDate,
        amount:
          dto.amountMinor !== null
            ? this.formatMinorAmount(dto.amountMinor)
            : lockedTransaction.amount,
        sum:
          dto.amountMinor !== null
            ? this.formatMinorAmount(dto.amountMinor)
            : lockedTransaction.sum,
        currency: dto.currencyCode || lockedTransaction.currency,
      });

      if (lockedTransaction.isCardUpdating && normalizedStatus === TransactionStatus.HOLD) {
        await this.paymentsApiService.cancelInvoice(lockedTransaction.invoiceId);
      }

      const updatedTransaction = await transactionsRepository.findOne({
        where: { transactionId: lockedTransaction.transactionId },
      });
      const updatedSubscription = await subscriptionsRepository.findOne({
        where: { subscriptionId: subscription.subscriptionId },
        relations: { card: true },
      });

      if (!updatedTransaction || !updatedSubscription) {
        throw new NotFoundException('Updated payments entities were not found.');
      }

      return {
        userId: updatedSubscription.userId,
        updatedTransaction,
        updatedSubscription,
        shouldEmitCardLinked,
      };
    });

    if (!emissionResult) {
      return;
    }

    if (
      !emissionResult.updatedTransaction.isCardUpdating &&
      [
        TransactionStatus.PROCESSING,
        TransactionStatus.SUCCESS,
        TransactionStatus.FAILURE,
      ].includes(emissionResult.updatedTransaction.status as TransactionStatus)
    ) {
      this.paymentsGateway.emitTransactionUpdated(
        emissionResult.userId,
        this.buildTransactionResponse(emissionResult.updatedTransaction),
      );
    }

    if (emissionResult.shouldEmitCardLinked && emissionResult.updatedSubscription.card) {
      this.paymentsGateway.emitCardLinked(emissionResult.userId, {
        card: {
          cardId: emissionResult.updatedSubscription.card.cardId,
          paymentSystem: emissionResult.updatedSubscription.card.paymentSystem,
          maskedNumber: emissionResult.updatedSubscription.card.maskedNumber,
        },
        subscription: this.buildSubscriptionResponse(emissionResult.updatedSubscription),
      });
    }
  }

  async recoverTransactionStatus(transaction: Transaction): Promise<void> {
    const providerStatus = await this.paymentsApiService.fetchInvoiceStatus(transaction.invoiceId);
    await this.processInvoiceStatus(transaction, this.normalizeInvoiceStatus(providerStatus));
  }

  async runBillingCycle(): Promise<void> {
    const now = new Date();
    const activeDue = await this.subscriptionsRepository.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        nextPaymentDate: LessThanOrEqual(this.toDateOnlyString(now)),
      },
      relations: { card: true },
    });

    const pastDue = await this.subscriptionsRepository
      .createQueryBuilder('subscription')
      .leftJoinAndSelect('subscription.card', 'card')
      .where('subscription.status = :status', { status: SubscriptionStatus.PAST_DUE })
      .andWhere('subscription.next_payment_date <= :today', { today: this.toDateOnlyString(now) })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM transactions transaction
          WHERE transaction.subscription_id = subscription.subscription_id
            AND transaction.status = :failureStatus
            AND transaction.modified_date >= :cooldownBoundary
        )`,
        {
          failureStatus: TransactionStatus.FAILURE,
          cooldownBoundary: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        },
      )
      .getMany();

    for (const subscription of [...activeDue, ...pastDue]) {
      if (!subscription.card?.token) {
        continue;
      }

      try {
        const invoice = await this.paymentsApiService.createWalletPayment({
          amount: PREMIUM_PRICE_AMOUNT_USD_MINOR,
          ccy: PREMIUM_PRICE_CURRENCY_NUMERIC,
          paymentType: 'debit',
          initiationKind: 'merchant',
          webHookUrl: this.getPaymentsWebhookUrl(),
          cardToken: subscription.card.token,
          walletId: subscription.walletId,
          metadata: {
            subscriptionId: subscription.subscriptionId,
            recurring: true,
          },
        });

        await this.transactionsRepository.save(
          this.transactionsRepository.create({
            subscriptionId: subscription.subscriptionId,
            invoiceId: invoice.invoiceId,
            status: invoice.status
              ? this.mapProviderStatus(invoice.status)
              : TransactionStatus.CREATED,
            type: TransactionType.CHARGE,
            sum: PREMIUM_PRICE_AMOUNT_USD,
            amount: PREMIUM_PRICE_AMOUNT_USD,
            currency: PREMIUM_PRICE_CURRENCY_CODE,
            modifiedDate: invoice.modifiedDate
              ? new Date(invoice.modifiedDate)
              : new Date(Date.now() - 1000),
            isCardUpdating: false,
          }),
        );

        await this.applyPendingWebhook(invoice.invoiceId);
      } catch (error) {
        this.logger.warn(`Recurring billing failed for subscription ${subscription.subscriptionId}`);
      }
    }
  }

  async markExpiredTransactions(): Promise<void> {
    const boundary = new Date(Date.now() - INVOICE_VALIDITY_SECONDS * 1000);
    await this.transactionsRepository
      .createQueryBuilder()
      .update(Transaction)
      .set({
        status: TransactionStatus.EXPIRED,
        modifiedDate: new Date(),
      })
      .where('(status IS NULL OR status = :createdStatus)', { createdStatus: TransactionStatus.CREATED })
      .andWhere('created_at <= :boundary', { boundary: boundary.toISOString() })
      .execute();
  }

  private async getOrCreateSubscription(userId: number): Promise<Subscription> {
    const existing = await this.subscriptionsRepository.findOne({
      where: { userId },
      relations: { card: true },
    });
    if (existing) {
      if (!existing.walletId) {
        existing.walletId = randomBytes(16).toString('hex');
        await this.subscriptionsRepository.update(existing.subscriptionId, {
          walletId: existing.walletId,
        });
      }

      return existing;
    }

    return this.subscriptionsRepository.save(
      this.subscriptionsRepository.create({
        userId,
        status: SubscriptionStatus.CREATED,
        startDate: null,
        nextPaymentDate: null,
        cancellationDate: null,
        walletId: randomBytes(16).toString('hex'),
      }),
    );
  }

  private getPaymentsWebhookUrl(): string {
    const value = this.configService.get<string>('PAYMENTS_WEBHOOK_URL')?.trim();

    if (!value) {
      throw new BadRequestException('PAYMENTS_WEBHOOK_URL is not configured.');
    }

    try {
      return new URL(value).toString();
    } catch {
      throw new BadRequestException('PAYMENTS_WEBHOOK_URL must be a valid absolute URL.');
    }
  }

  private async requireSubscription(userId: number): Promise<Subscription> {
    const subscription = await this.subscriptionsRepository.findOne({
      where: { userId },
      relations: { card: true },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    return subscription;
  }

  private buildSubscriptionResponse(subscription: Subscription): SubscriptionResponse {
    return {
      subscriptionId: subscription.subscriptionId,
      userId: subscription.userId,
      status: subscription.status,
      startDate: subscription.startDate,
      nextPaymentDate: subscription.nextPaymentDate,
      cancellationDate: subscription.cancellationDate,
      walletId: subscription.walletId,
      card: subscription.card
        ? {
            cardId: subscription.card.cardId,
            paymentSystem: subscription.card.paymentSystem,
            maskedNumber: subscription.card.maskedNumber,
          }
        : null,
    };
  }

  private buildTransactionResponse(transaction: Transaction): SubscriptionTransactionResponse {
    return {
      transactionId: transaction.transactionId,
      invoiceId: transaction.invoiceId,
      status: transaction.status,
      type: transaction.type,
      amount: transaction.amount ?? transaction.sum,
      currency: transaction.currency,
      isCardUpdating: transaction.isCardUpdating,
      modifiedDate: transaction.modifiedDate,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  private async verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string,
    forceRefresh = false,
  ): Promise<boolean> {
    const publicKey = await this.fetchAndCachePublicKey(forceRefresh);
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();

    try {
      return verifier.verify(publicKey, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  private async fetchAndCachePublicKey(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedPublicKey &&
      now - this.publicKeyFetchedAt < PUBLIC_KEY_REFRESH_COOLDOWN_MS
    ) {
      return this.cachedPublicKey;
    }

    const publicKey = await this.paymentsApiService.fetchPublicKey();
    this.cachedPublicKey = publicKey;
    this.publicKeyFetchedAt = now;
    return publicKey;
  }

  private normalizeInvoiceStatus(dto: Partial<InvoiceStatusDto>): NormalizedInvoiceStatus {
    if (!dto.invoiceId || !dto.status) {
      throw new BadRequestException('Webhook payload is incomplete.');
    }

    const modifiedDate = dto.modifiedDate ? new Date(dto.modifiedDate) : new Date();
    if (Number.isNaN(modifiedDate.getTime())) {
      throw new BadRequestException('Webhook modifiedDate is invalid.');
    }

    return {
      invoiceId: dto.invoiceId,
      status: dto.status,
      amountMinor:
        typeof dto.amount === 'number' && Number.isFinite(dto.amount)
          ? dto.amount
          : null,
      currencyCode:
        dto.ccy === undefined || dto.ccy === null ? null : String(dto.ccy).trim() || null,
      createdDate: dto.createdDate,
      modifiedDate: modifiedDate.toISOString(),
      walletData: dto.walletData,
      paymentInfo: dto.paymentInfo,
    };
  }

  private mapProviderStatus(status: string): TransactionStatus {
    switch (status.trim().toLowerCase()) {
      case 'created':
        return TransactionStatus.CREATED;
      case 'processing':
      case 'pending':
        return TransactionStatus.PROCESSING;
      case 'hold':
        return TransactionStatus.HOLD;
      case 'success':
        return TransactionStatus.SUCCESS;
      case 'failure':
      case 'failed':
        return TransactionStatus.FAILURE;
      case 'reversed':
      case 'refunded':
        return TransactionStatus.REVERSED;
      case 'expired':
        return TransactionStatus.EXPIRED;
      default:
        throw new BadRequestException(`Unsupported transaction status: ${status}`);
    }
  }

  private async replaceSubscriptionCard(
    manager: EntityManager,
    subscription: Subscription,
    cardToken: string,
    paymentSystem?: string,
    maskedPan?: string,
  ): Promise<void> {
    if (subscription.card?.token && subscription.card.token !== cardToken) {
      try {
        await this.paymentsApiService.deleteCard(subscription.card.token);
      } catch (error) {
        this.logger.warn(`Failed to delete previous provider card token: ${subscription.card.token}`);
      }
    }

    if (subscription.card) {
      await manager.getRepository(Card).delete({ cardId: subscription.card.cardId });
    }

    await manager.getRepository(Card).save(
      manager.getRepository(Card).create({
        subscriptionId: subscription.subscriptionId,
        token: cardToken,
        paymentSystem: paymentSystem?.trim() || 'unknown',
        maskedNumber: maskedPan?.trim() || 'unknown',
      }),
    );
  }

  private async resolveFailureSubscriptionStatus(
    manager: EntityManager,
    subscription: Subscription,
    currentTransactionId: number,
    currentTransactionStatus: TransactionStatus | null,
  ): Promise<SubscriptionStatus> {
    if (subscription.status === SubscriptionStatus.ACTIVE) {
      return SubscriptionStatus.PAST_DUE;
    }

    if (subscription.status !== SubscriptionStatus.PAST_DUE) {
      return subscription.status;
    }

    const lastSuccess = await manager.getRepository(Transaction).findOne({
      where: {
        subscriptionId: subscription.subscriptionId,
        status: TransactionStatus.SUCCESS,
      },
      order: { modifiedDate: 'DESC', transactionId: 'DESC' },
    });

    const failuresCount = await manager
      .getRepository(Transaction)
      .createQueryBuilder('transaction')
      .where('transaction.subscription_id = :subscriptionId', {
        subscriptionId: subscription.subscriptionId,
      })
      .andWhere('transaction.status = :status', {
        status: TransactionStatus.FAILURE,
      })
      .andWhere(lastSuccess ? 'transaction.modified_date > :lastSuccessDate' : '1=1', {
        lastSuccessDate: lastSuccess?.modifiedDate?.toISOString(),
      })
      .andWhere('transaction.transaction_id <= :currentTransactionId', { currentTransactionId })
      .getCount();

    const normalizedFailuresCount =
      currentTransactionStatus === TransactionStatus.FAILURE ? failuresCount : failuresCount + 1;

    return normalizedFailuresCount >= SUBSCRIPTION_RETRY_COUNT
      ? SubscriptionStatus.CANCELLED
      : SubscriptionStatus.PAST_DUE;
  }

  private async restoreIncompleteTransactions(): Promise<void> {
    const transactions = await this.transactionsRepository.find({
      where: [
        { status: IsNull() },
        { status: TransactionStatus.CREATED },
        { status: TransactionStatus.PROCESSING },
      ],
      order: { createdAt: 'ASC' },
      take: 100,
    });

    for (const transaction of transactions) {
      try {
        await this.recoverTransactionStatus(transaction);
      } catch (error) {
        this.logger.warn(
          `Failed to recover transaction ${transaction.invoiceId}: ${this.getErrorMessage(error)}`,
        );
      }
    }
  }

  private async applyPendingWebhook(invoiceId: string): Promise<void> {
    const pending = this.pendingWebhooks.get(invoiceId);
    if (!pending) {
      return;
    }

    const transaction = await this.transactionsRepository.findOne({
      where: { invoiceId },
    });
    if (!transaction) {
      return;
    }

    await this.processInvoiceStatus(transaction, pending);
    this.pendingWebhooks.delete(invoiceId);
  }

  private addMonth(date: Date): Date {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const candidate = new Date(Date.UTC(year, month + 1, 1));
    const lastDayOfTargetMonth = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
    candidate.setUTCDate(Math.min(day, lastDayOfTargetMonth));
    candidate.setUTCHours(0, 0, 0, 0);
    return candidate;
  }

  private toDateOnlyString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private formatMinorAmount(amountMinor: number): string {
    return (amountMinor / 100).toFixed(2);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error';
  }
}
