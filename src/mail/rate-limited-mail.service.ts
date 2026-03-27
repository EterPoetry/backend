import { Injectable } from '@nestjs/common';
import { MailjetService } from './mailjet.service';
import { MailRequestLimitService } from './mail-request-limit.service';

interface MailRecipient {
  email: string;
  name?: string;
}

@Injectable()
export class RateLimitedMailService {
  constructor(
    private readonly mailjetService: MailjetService,
    private readonly mailRequestLimitService: MailRequestLimitService,
  ) {}

  async sendPasswordResetEmail(
    ipAddress: string | null,
    payloadFactory: () => Promise<{ recipient: MailRecipient; resetUrl: string }>,
  ): Promise<void> {
    if (!(await this.mailRequestLimitService.registerAttemptAndCheckAllowed(ipAddress))) {
      return;
    }

    const { recipient, resetUrl } = await payloadFactory();
    await this.mailjetService.sendPasswordResetEmail(recipient, resetUrl);
  }

  async sendEmailVerificationEmail(
    ipAddress: string | null,
    payloadFactory: () => Promise<{ recipient: MailRecipient; verificationUrl: string }>,
  ): Promise<void> {
    if (!(await this.mailRequestLimitService.registerAttemptAndCheckAllowed(ipAddress))) {
      return;
    }

    const { recipient, verificationUrl } = await payloadFactory();
    await this.mailjetService.sendEmailVerificationEmail(recipient, verificationUrl);
  }
}
