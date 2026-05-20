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
    payloadFactory: () => Promise<{ recipient: MailRecipient; verificationCode: string }>,
  ): Promise<void> {
    if (!(await this.mailRequestLimitService.registerAttemptAndCheckAllowed(ipAddress))) {
      return;
    }

    const { recipient, verificationCode } = await payloadFactory();
    await this.mailjetService.sendEmailVerificationEmail(recipient, verificationCode);
  }

  async sendAdminInvitationEmail(recipient: MailRecipient, inviteUrl: string): Promise<void> {
    await this.mailjetService.sendAdminInvitationEmail(recipient, inviteUrl);
  }

  async sendViolationEmail(
    recipient: MailRecipient,
    reasonLabel: string,
    expiresAt: Date | null,
  ): Promise<void> {
    await this.mailjetService.sendViolationEmail(recipient, reasonLabel, expiresAt);
  }

  async sendAccountBlockedEmail(recipient: MailRecipient): Promise<void> {
    await this.mailjetService.sendAccountBlockedEmail(recipient);
  }

  async sendAccountUnblockedEmail(recipient: MailRecipient): Promise<void> {
    await this.mailjetService.sendAccountUnblockedEmail(recipient);
  }
}
