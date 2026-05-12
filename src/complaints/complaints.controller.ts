import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ComplaintReason } from '../common/enums/complaint-reason.enum';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import {
  ComplaintReasonResponse,
  ComplaintResponse,
  ComplaintsService,
} from './complaints.service';

interface RequestWithUser extends Request {
  user: { userId: number; email?: string };
}

class ComplaintReasonResponseDto implements ComplaintReasonResponse {
  @ApiProperty({ enum: ComplaintReason, enumName: 'ComplaintReason' })
  key: ComplaintReason;

  @ApiProperty()
  label: string;
}

class ComplaintResponseDto implements ComplaintResponse {
  @ApiProperty()
  complaintId: number;

  @ApiProperty()
  authorId: number;

  @ApiProperty()
  targetUserId: number;

  @ApiProperty()
  targetPostId: number;

  @ApiProperty({ enum: ComplaintReason, enumName: 'ComplaintReason' })
  complaintReason: ComplaintReason;

  @ApiProperty()
  complaintReasonLabel: string;

  @ApiProperty({ enum: ComplaintStatus, enumName: 'ComplaintStatus' })
  status: ComplaintStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  expiresAt: Date | null;
}

@Controller('complaints')
@ApiTags('Complaints')
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Get('reasons')
  getComplaintReasons(): ComplaintReasonResponseDto[] {
    return this.complaintsService.getComplaintReasons();
  }

  @Post(':postId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createComplaint(
    @Req() req: RequestWithUser,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: CreateComplaintDto,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.createComplaint(req.user.userId, postId, dto);
  }
}
