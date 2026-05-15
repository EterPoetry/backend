import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class WalletDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  walletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cardToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

class PaymentInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentSystem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maskedPan?: string;
}

export class InvoiceStatusDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ccy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdDate?: string;

  @ApiProperty()
  @IsDateString()
  modifiedDate: string;

  @ApiPropertyOptional({ type: () => WalletDataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WalletDataDto)
  walletData?: WalletDataDto;

  @ApiPropertyOptional({ type: () => PaymentInfoDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PaymentInfoDto)
  paymentInfo?: PaymentInfoDto;
}
