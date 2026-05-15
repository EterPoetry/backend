import { ApiProperty } from '@nestjs/swagger';

export class CheckoutSubscriptionResponseDto {
  @ApiProperty()
  invoiceId: string;

  @ApiProperty()
  checkoutUrl: string;
}
