import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutSubscriptionResponseDto {
  @ApiProperty()
  invoiceId: string;

  @ApiPropertyOptional({ nullable: true })
  checkoutUrl: string | null;
}
