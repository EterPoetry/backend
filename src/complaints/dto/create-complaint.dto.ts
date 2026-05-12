import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ComplaintReason } from '../../common/enums/complaint-reason.enum';

export class CreateComplaintDto {
  @ApiProperty({ enum: ComplaintReason, enumName: 'ComplaintReason' })
  @IsEnum(ComplaintReason)
  complaintReason: ComplaintReason;
}
