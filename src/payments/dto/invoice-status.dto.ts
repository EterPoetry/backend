import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsNumber,
  IsNumberString,
  ValidateIf,
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
  maskedPan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approvalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rrn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tranId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  terminal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bank?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentSystem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  agentFee?: number;
}

class CancelListItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  modifiedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  extRef?: string;
}

class TipsInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;
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
  @IsNumber()
  finalAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string')
  @IsNumberString()
  @ValidateIf((_, value) => typeof value === 'number')
  @IsNumber()
  ccy?: string | number;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  errCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiPropertyOptional({ type: () => [CancelListItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelListItemDto)
  cancelList?: CancelListItemDto[];

  @ApiPropertyOptional({ type: () => TipsInfoDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TipsInfoDto)
  tipsInfo?: TipsInfoDto;
}
