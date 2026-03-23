import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface MailjetRecipient {
  email: string;
  name?: string;
}

@Injectable()
export class MailjetService {
  constructor(private readonly configService: ConfigService) {}

  async sendPasswordResetEmail(recipient: MailjetRecipient, resetUrl: string): Promise<void> {
    const { apiKey, apiSecret, senderEmail, senderName } = this.getConfig();
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    const payload = {
      Messages: [
        {
          From: {
            Email: senderEmail,
            Name: senderName,
          },
          To: [
            {
              Email: recipient.email,
              Name: recipient.name ?? recipient.email,
            },
          ],
          Subject: 'Reset your password',
          TextPart: `Use this link to reset your password: ${resetUrl}`,
          HTMLPart: `<p>Use this link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
        },
      ],
    };

    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Failed to send reset email via Mailjet: ${response.status} ${errorText}`,
      );
    }
  }

  async sendEmailVerificationEmail(
    recipient: MailjetRecipient,
    verificationUrl: string,
  ): Promise<void> {
    const { apiKey, apiSecret, senderEmail, senderName } = this.getConfig();
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    const payload = {
      Messages: [
        {
          From: {
            Email: senderEmail,
            Name: senderName,
          },
          To: [
            {
              Email: recipient.email,
              Name: recipient.name ?? recipient.email,
            },
          ],
          Subject: 'Verify your email',
          TextPart: `Use this link to verify your email: ${verificationUrl}`,
          HTMLPart: `<p>Use this link to verify your email:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
        },
      ],
    };

    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Failed to send verification email via Mailjet: ${response.status} ${errorText}`,
      );
    }
  }

  private getConfig(): {
    apiKey: string;
    apiSecret: string;
    senderEmail: string;
    senderName: string;
  } {
    const apiKey = this.configService.get<string>('MAILJET_API_KEY');
    const apiSecret = this.configService.get<string>('MAILJET_API_SECRET');
    const senderEmail = this.configService.get<string>('MAILJET_SENDER_EMAIL');
    const senderName =
      this.configService.get<string>('MAILJET_SENDER_NAME') ?? 'Eter Poetry';

    if (!apiKey || !apiSecret || !senderEmail) {
      throw new ServiceUnavailableException('Mailjet is not configured.');
    }

    return {
      apiKey,
      apiSecret,
      senderEmail,
      senderName,
    };
  }
}
