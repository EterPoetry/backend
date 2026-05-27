import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RecordingConfig {
  freeDurationLimitMinutes: number;
  premiumDurationLimitMinutes: number;
}

export interface SubscriptionConfig {
  priceUsd: number;
}

export interface NotificationsConfig {
  webPushEnabled: boolean;
  webPushPublicKey: string | null;
  androidPushEnabled: boolean;
}

export interface PublicConfigResponse {
  recording: RecordingConfig;
  subscription: SubscriptionConfig;
  notifications: NotificationsConfig;
}

const DEFAULT_FREE_RECORDING_DURATION_LIMIT_MINUTES = 7;
const DEFAULT_PREMIUM_RECORDING_DURATION_LIMIT_MINUTES = 15;
const DEFAULT_SUBSCRIPTION_PRICE_USD = 5;

@Injectable()
export class PublicConfigService {
  constructor(private readonly configService: ConfigService) {}

  getPublicConfig(): PublicConfigResponse {
    return {
      recording: {
        freeDurationLimitMinutes: this.getPositiveNumber(
          'FREE_RECORDING_DURATION_LIMIT_MINUTES',
          DEFAULT_FREE_RECORDING_DURATION_LIMIT_MINUTES,
        ),
        premiumDurationLimitMinutes: this.getPositiveNumber(
          'PREMIUM_RECORDING_DURATION_LIMIT_MINUTES',
          DEFAULT_PREMIUM_RECORDING_DURATION_LIMIT_MINUTES,
        ),
      },
      subscription: {
        priceUsd: this.getPositiveNumber('SUBSCRIPTION_PRICE_USD', DEFAULT_SUBSCRIPTION_PRICE_USD),
      },
      notifications: {
        webPushEnabled: Boolean(
          this.getTrimmedConfigValue('WEB_PUSH_VAPID_PUBLIC_KEY') &&
            this.getTrimmedConfigValue('WEB_PUSH_VAPID_PRIVATE_KEY') &&
            (this.getTrimmedConfigValue('WEB_PUSH_VAPID_SUBJECT') ||
              this.getTrimmedConfigValue('MAILJET_SENDER_EMAIL')),
        ),
        webPushPublicKey: this.getTrimmedConfigValue('WEB_PUSH_VAPID_PUBLIC_KEY'),
        androidPushEnabled: Boolean(
          this.getTrimmedConfigValue('FIREBASE_SERVICE_ACCOUNT_JSON') ||
            (this.getTrimmedConfigValue('FIREBASE_PROJECT_ID') &&
              this.getTrimmedConfigValue('FIREBASE_CLIENT_EMAIL') &&
              this.getTrimmedConfigValue('FIREBASE_PRIVATE_KEY')),
        ),
      },
    };
  }

  getRecordingDurationLimitMinutes(isPremium: boolean): number {
    const config = this.getPublicConfig();
    return isPremium
      ? config.recording.premiumDurationLimitMinutes
      : config.recording.freeDurationLimitMinutes;
  }

  private getPositiveNumber(key: string, fallback: number): number {
    const rawValue = this.configService.get<string>(key)?.trim();
    if (!rawValue) {
      return fallback;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return fallback;
    }

    return parsedValue;
  }

  private getTrimmedConfigValue(key: string): string | null {
    const rawValue = this.configService.get<string>(key)?.trim();
    return rawValue ? rawValue : null;
  }
}
