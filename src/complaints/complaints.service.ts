import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ComplaintReason,
  COMPLAINT_REASON_LABELS,
} from '../common/enums/complaint-reason.enum';
import { ComplaintStatus } from '../common/enums/complaint-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { Post } from '../posts/entities/post.entity';
import { QueryFailedError, Repository } from 'typeorm';
import { PostComplaint } from './entities/post-complaint.entity';
import { CreateComplaintDto } from './dto/create-complaint.dto';

export interface ComplaintReasonResponse {
  key: ComplaintReason;
  label: string;
}

export interface ComplaintResponse {
  complaintId: number;
  authorId: number;
  targetUserId: number;
  targetPostId: number;
  complaintReason: ComplaintReason;
  complaintReasonLabel: string;
  status: ComplaintStatus;
  createdAt: Date;
  expiresAt: Date | null;
}

@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(PostComplaint)
    private readonly complaintsRepository: Repository<PostComplaint>,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    private readonly notificationsService: NotificationsService,
  ) {}

  getComplaintReasons(): ComplaintReasonResponse[] {
    return Object.values(ComplaintReason).map((reason) => ({
      key: reason,
      label: COMPLAINT_REASON_LABELS[reason],
    }));
  }

  async createComplaint(
    userId: number,
    postId: number,
    dto: CreateComplaintDto,
  ): Promise<ComplaintResponse> {
    const post = await this.postsRepository.findOne({
      where: { postId },
      select: {
        postId: true,
        authorId: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    if (post.authorId === userId) {
      throw new BadRequestException('You cannot submit a complaint about your own post.');
    }

    const existingComplaint = await this.complaintsRepository.exist({
      where: {
        authorId: userId,
        targetPostId: post.postId,
      },
    });

    if (existingComplaint) {
      throw new ConflictException('You have already submitted a complaint for this post.');
    }

    const complaint = this.complaintsRepository.create({
      authorId: userId,
      targetUserId: post.authorId,
      targetPostId: post.postId,
      complaintReason: dto.complaintReason,
      status: ComplaintStatus.PENDING,
      adminId: null,
      expiresAt: null,
    });

    let savedComplaint: PostComplaint;

    try {
      savedComplaint = await this.complaintsRepository.save(complaint);
    } catch (error) {
      if (this.isDuplicateComplaintError(error)) {
        throw new ConflictException('You have already submitted a complaint for this post.');
      }
      throw error;
    }

    return this.mapComplaintResponse(savedComplaint);
  }

  async resolveComplaint(
    complaintId: number,
    adminId: number | null,
    expiresAt: Date | null,
  ): Promise<ComplaintResponse> {
    const complaint = await this.complaintsRepository.findOne({
      where: { postComplaintId: complaintId },
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found.');
    }

    if (complaint.status === ComplaintStatus.RESOLVED) {
      return this.mapComplaintResponse(complaint);
    }

    if (complaint.status !== ComplaintStatus.PENDING) {
      throw new ConflictException('Only pending complaints can be resolved.');
    }

    complaint.status = ComplaintStatus.RESOLVED;
    complaint.adminId = adminId;
    complaint.expiresAt = expiresAt;

    const savedComplaint = await this.complaintsRepository.save(complaint);

    await this.notificationsService.recordPostViolationConfirmed(
      savedComplaint.targetUserId,
      savedComplaint.targetPostId,
      savedComplaint.postComplaintId,
    );

    return this.mapComplaintResponse(savedComplaint);
  }

  private mapComplaintResponse(complaint: PostComplaint): ComplaintResponse {
    return {
      complaintId: complaint.postComplaintId,
      authorId: complaint.authorId,
      targetUserId: complaint.targetUserId,
      targetPostId: complaint.targetPostId,
      complaintReason: complaint.complaintReason,
      complaintReasonLabel: COMPLAINT_REASON_LABELS[complaint.complaintReason],
      status: complaint.status,
      createdAt: complaint.createdAt,
      expiresAt: complaint.expiresAt,
    };
  }

  private isDuplicateComplaintError(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      typeof (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code ===
        'string' &&
      (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505'
    );
  }
}
