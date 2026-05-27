import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as webPush from 'web-push';
import { Repository } from 'typeorm';
import { NotificationResponse } from './notifications.service';
import { BrowserPushSubscription } from './entities/browser-push-subscription.entity';
import { PushNotificationSettings } from './entities/push-notification-settings.entity';
import { SaveBrowserPushSubscriptionDto } from './dto/save-browser-push-subscription.dto';
import { UpdatePushSettingsDto } from './dto/update-push-settings.dto';
import { NotificationType } from './notification-type.enum';
import { PushNotificationContentService } from './push-notification-content.service';

export interface PushSettingsResponse {
  disabledTypes: NotificationType[];
}

export interface UpdatePushSettingsResponse {
  ok: true;
  disabledTypes: NotificationType[];
}

interface BrowserPushPayload {
  type: 'notifications.updated';
  unreadCount: number;
  unseenCount: number;
  notification: NotificationResponse;
  webPush: {
    title: string;
    body: string;
    tag: string;
    renotify: boolean;
  };
}

@Injectable()
export class BrowserPushNotificationsService {
  private readonly logger = new Logger(BrowserPushNotificationsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pushNotificationContentService: PushNotificationContentService,
    @InjectRepository(BrowserPushSubscription)
    private readonly browserPushSubscriptionsRepository: Repository<BrowserPushSubscription>,
    @InjectRepository(PushNotificationSettings)
    private readonly pushNotificationSettingsRepository: Repository<PushNotificationSettings>,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.getPublicKey() && this.getPrivateKey() && this.getSubject());
  }

  getPublicKey(): string | null {
    return this.getTrimmedConfigValue('WEB_PUSH_VAPID_PUBLIC_KEY');
  }

  async saveSubscription(
    userId: number,
    dto: SaveBrowserPushSubscriptionDto,
    userAgent: string | null,
  ): Promise<{ ok: true }> {
    const existingSubscription = await this.browserPushSubscriptionsRepository.findOne({
      where: { endpoint: dto.endpoint },
    });

    const entity = existingSubscription ?? this.browserPushSubscriptionsRepository.create();
    entity.userId = userId;
    entity.endpoint = dto.endpoint;
    entity.p256dhKey = dto.keys.p256dh;
    entity.authKey = dto.keys.auth;
    entity.expirationTime = dto.expirationTime ?? null;
    entity.userAgent = userAgent;
    entity.lastFailureAt = null;
    entity.lastFailureStatusCode = null;

    await this.browserPushSubscriptionsRepository.save(entity);

    return { ok: true };
  }

  async deleteSubscription(userId: number, endpoint: string): Promise<{ ok: true }> {
    await this.browserPushSubscriptionsRepository.delete({
      userId,
      endpoint,
    });

    return { ok: true };
  }

  async getSettings(userId: number): Promise<PushSettingsResponse> {
    const settings = await this.pushNotificationSettingsRepository.findOne({
      where: { userId },
    });

    return { disabledTypes: settings?.disabledTypes ?? [] };
  }

  async updateSettings(
    userId: number,
    dto: UpdatePushSettingsDto,
  ): Promise<UpdatePushSettingsResponse> {
    const existing = await this.pushNotificationSettingsRepository.findOne({
      where: { userId },
    });

    const entity = existing ?? this.pushNotificationSettingsRepository.create({ userId });
    entity.disabledTypes = dto.disabledTypes;

    await this.pushNotificationSettingsRepository.save(entity);

    return { ok: true, disabledTypes: entity.disabledTypes };
  }

  async sendNotification(
    recipientUserId: number,
    notification: NotificationResponse,
    unreadCount: number,
    unseenCount: number,
  ): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const settings = await this.getSettings(recipientUserId);
    if (settings.disabledTypes.includes(notification.notificationType)) {
      return;
    }

    const subscriptions = await this.browserPushSubscriptionsRepository.find({
      where: { userId: recipientUserId },
    });

    if (!subscriptions.length) {
      return;
    }

    this.configureWebPush();
    const payload = this.buildPayload(notification, unreadCount, unseenCount);
    const serializedPayload = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              expirationTime: subscription.expirationTime?.getTime() ?? null,
              keys: {
                p256dh: subscription.p256dhKey,
                auth: subscription.authKey,
              },
            },
            serializedPayload,
            {
              TTL: 60,
              urgency: 'normal',
            },
          );

          await this.browserPushSubscriptionsRepository.update(
            { browserPushSubscriptionId: subscription.browserPushSubscriptionId },
            {
              lastSuccessAt: new Date(),
              lastFailureAt: null,
              lastFailureStatusCode: null,
            },
          );
        } catch (error) {
          const statusCode = this.extractStatusCode(error);

          this.logger.warn(
            `Browser push failed userId=${recipientUserId} subscriptionId=${subscription.browserPushSubscriptionId} endpoint=${subscription.endpoint} statusCode=${statusCode ?? 'unknown'}`,
          );

          if (statusCode === 404 || statusCode === 410) {
            await this.browserPushSubscriptionsRepository.delete({
              browserPushSubscriptionId: subscription.browserPushSubscriptionId,
            });
            return;
          }

          await this.browserPushSubscriptionsRepository.update(
            { browserPushSubscriptionId: subscription.browserPushSubscriptionId },
            {
              lastFailureAt: new Date(),
              lastFailureStatusCode: statusCode,
            },
          );
        }
      }),
    );
  }

  private configureWebPush(): void {
    const publicKey = this.getPublicKey();
    const privateKey = this.getPrivateKey();
    const subject = this.getSubject();

    if (!publicKey || !privateKey || !subject) {
      return;
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);
  }

  private buildPayload(
    notification: NotificationResponse,
    unreadCount: number,
    unseenCount: number,
  ): BrowserPushPayload {
    const webPushContent = this.buildWebPushContent(notification);

    return {
      type: 'notifications.updated',
      unreadCount,
      unseenCount,
      notification,
      webPush: webPushContent,
    };
  }

  private buildWebPushContent(notification: NotificationResponse): BrowserPushPayload['webPush'] {
    return this.pushNotificationContentService.build(notification);
  }

  private getPrivateKey(): string | null {
    return this.getTrimmedConfigValue('WEB_PUSH_VAPID_PRIVATE_KEY');
  }

  private getSubject(): string | null {
    const configuredSubject = this.getTrimmedConfigValue('WEB_PUSH_VAPID_SUBJECT');
    if (configuredSubject) {
      return configuredSubject;
    }

    const senderEmail = this.getTrimmedConfigValue('MAILJET_SENDER_EMAIL');
    return senderEmail ? `mailto:${senderEmail}` : null;
  }

  private getTrimmedConfigValue(key: string): string | null {
    const value = this.configService.get<string>(key)?.trim();
    return value ? value : null;
  }

  private extractStatusCode(error: unknown): number | null {
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    return typeof statusCode === 'number' ? statusCode : null;
  }
}
