import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { TransactionStatus } from '../common/enums/transaction-status.enum';
import { TransactionType } from '../common/enums/transaction-type.enum';
import { GetSubscriptionTransactionsQueryDto } from './dto/get-subscription-transactions-query.dto';
import { CheckoutSubscriptionResponseDto } from './dto/checkout-subscription.dto';
import { InvoiceStatusDto } from './dto/invoice-status.dto';
import {
  PaginatedTransactionsResponse,
  PaymentsService,
  SubscriptionCardResponse,
  SubscriptionResponse,
  SubscriptionTransactionResponse,
} from './payments.service';

interface RequestWithUser extends Request {
  user?: { userId: number; email?: string };
  rawBody?: Buffer;
}

class SubscriptionCardResponseDto implements SubscriptionCardResponse {
  @ApiProperty()
  cardId: number;

  @ApiProperty()
  paymentSystem: string;

  @ApiProperty()
  maskedNumber: string;
}

class SubscriptionResponseDto implements SubscriptionResponse {
  @ApiProperty()
  subscriptionId: number;

  @ApiProperty()
  userId: number;

  @ApiProperty()
  status: SubscriptionStatus;

  @ApiPropertyOptional({ nullable: true })
  startDate: string | null;

  @ApiPropertyOptional({ nullable: true })
  nextPaymentDate: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationDate: string | null;

  @ApiPropertyOptional({ nullable: true })
  walletId: string | null;

  @ApiPropertyOptional({ type: () => SubscriptionCardResponseDto, nullable: true })
  card: SubscriptionCardResponseDto | null;
}

class SubscriptionTransactionResponseDto implements SubscriptionTransactionResponse {
  @ApiProperty()
  transactionId: number;

  @ApiProperty()
  invoiceId: string;

  @ApiPropertyOptional({ nullable: true })
  status: TransactionStatus | null;

  @ApiProperty()
  type: TransactionType;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  isCardUpdating: boolean;

  @ApiPropertyOptional({ nullable: true })
  modifiedDate: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

class PaginatedTransactionsResponseDto implements PaginatedTransactionsResponse {
  @ApiProperty({ type: [SubscriptionTransactionResponseDto] })
  items: SubscriptionTransactionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  offset: number;
}

@Controller('payments')
@ApiTags('Payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private requireUser(req: RequestWithUser): { userId: number; email?: string } {
    if (!req.user) {
      throw new ForbiddenException('Authentication required.');
    }

    return req.user;
  }

  @Post('subscription/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  checkoutSubscription(@Req() req: RequestWithUser): Promise<CheckoutSubscriptionResponseDto> {
    return this.paymentsService.checkoutSubscription(this.requireUser(req).userId);
  }

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(
    @Req() req: RequestWithUser,
    @Headers('x-sign') signature: string | undefined,
    @Body() dto: InvoiceStatusDto,
  ): Promise<void> {
    return this.paymentsService.handleWebhook(req.rawBody, signature, dto);
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getSubscription(@Req() req: RequestWithUser): Promise<SubscriptionResponseDto | null> {
    return this.paymentsService.getSubscription(this.requireUser(req).userId);
  }

  @Delete('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  cancelSubscription(@Req() req: RequestWithUser): Promise<{ ok: true }> {
    return this.paymentsService.cancelSubscription(this.requireUser(req).userId);
  }

  @Get('subscription/transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getSubscriptionTransactions(
    @Req() req: RequestWithUser,
    @Query() query: GetSubscriptionTransactionsQueryDto,
  ): Promise<PaginatedTransactionsResponseDto> {
    return this.paymentsService.getSubscriptionTransactions(this.requireUser(req).userId, query);
  }

  @Post('subscription/card/update')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updateSubscriptionCard(@Req() req: RequestWithUser): Promise<CheckoutSubscriptionResponseDto> {
    return this.paymentsService.updateSubscriptionCard(this.requireUser(req).userId);
  }
}
