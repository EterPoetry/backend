import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JWT } from 'google-auth-library';
import { Repository } from 'typeorm';
import { SaveAndroidPushTokenDto } from './dto/save-android-push-token.dto';
import { AndroidPushToken } from './entities/android-push-token.entity';
import { NotificationResponse } from './notifications.service';
import {
  PushMessageContent,
  PushNotificationContentService,
} from './push-notification-content.service';
import { PushNotificationSettings } from './entities/push-notification-settings.entity';

interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

interface FcmErrorResponse {
  error?: {
    details?: Array<{ errorCode?: unknown }>;
    message?: unknown;
    status?: unknown;
  };
}

@Injectable()
export class AndroidPushNotificationsService {
  private readonly logger = new Logger(AndroidPushNotificationsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pushNotificationContentService: PushNotificationContentService,
    @InjectRepository(AndroidPushToken)
    private readonly androidPushTokensRepository: Repository<AndroidPushToken>,
    @InjectRepository(PushNotificationSettings)
    private readonly pushNotificationSettingsRepository: Repository<PushNotificationSettings>,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.getServiceAccount());
  }

  async saveToken(userId: number, dto: SaveAndroidPushTokenDto): Promise<{ ok: true }> {
    const existingToken = await this.androidPushTokensRepository.findOne({
      where: { token: dto.token },
    });

    const entity = existingToken ?? this.androidPushTokensRepository.create();
    entity.userId = userId;
    entity.token = dto.token;
    entity.deviceId = dto.deviceId ?? null;
    entity.appVersion = dto.appVersion ?? null;
    entity.lastFailureAt = null;
    entity.lastFailureCode = null;

    await this.androidPushTokensRepository.save(entity);

    return { ok: true };
  }

  async deleteToken(userId: number, token: string): Promise<{ ok: true }> {
    await this.androidPushTokensRepository.delete({
      userId,
      token,
    });

    return { ok: true };
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

    const settings = await this.pushNotificationSettingsRepository.findOne({
      where: { userId: recipientUserId },
    });
    if (settings?.disabledTypes.includes(notification.notificationType)) {
      return;
    }

    const tokens = await this.androidPushTokensRepository.find({
      where: { userId: recipientUserId },
    });

    if (!tokens.length) {
      return;
    }

    const serviceAccount = this.getServiceAccount();
    if (!serviceAccount) {
      return;
    }

    const accessToken = await this.getAccessToken(serviceAccount);
    const content = this.pushNotificationContentService.build(notification);

    await Promise.all(
      tokens.map(async (tokenEntity) => {
        try {
          const response = await fetch(
            `https://fcm.googleapis.com/v1/projects/${serviceAccount.projectId}/messages:send`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: this.buildMessage(tokenEntity.token, notification, unreadCount, unseenCount, content),
              }),
            },
          );

          if (!response.ok) {
            const responseBody = (await response.json().catch(() => null)) as FcmErrorResponse | null;
            const errorCode = this.extractErrorCode(responseBody);

            this.logger.warn(
              `Android push failed userId=${recipientUserId} tokenId=${tokenEntity.androidPushTokenId} status=${response.status} code=${errorCode ?? 'unknown'}`,
            );

            if (errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT') {
              await this.androidPushTokensRepository.delete({
                androidPushTokenId: tokenEntity.androidPushTokenId,
              });
              return;
            }

            await this.androidPushTokensRepository.update(
              { androidPushTokenId: tokenEntity.androidPushTokenId },
              {
                lastFailureAt: new Date(),
                lastFailureCode: errorCode ?? String(response.status),
              },
            );
            return;
          }

          await this.androidPushTokensRepository.update(
            { androidPushTokenId: tokenEntity.androidPushTokenId },
            {
              lastSuccessAt: new Date(),
              lastFailureAt: null,
              lastFailureCode: null,
            },
          );
        } catch (error) {
          this.logger.warn(
            `Android push failed userId=${recipientUserId} tokenId=${tokenEntity.androidPushTokenId} error=${error instanceof Error ? error.message : 'unknown'}`,
          );

          await this.androidPushTokensRepository.update(
            { androidPushTokenId: tokenEntity.androidPushTokenId },
            {
              lastFailureAt: new Date(),
              lastFailureCode: 'REQUEST_FAILED',
            },
          );
        }
      }),
    );
  }

  private buildMessage(
    token: string,
    notification: NotificationResponse,
    unreadCount: number,
    unseenCount: number,
    content: PushMessageContent,
  ): Record<string, unknown> {
    return {
      token,
      notification: {
        title: content.title,
        body: content.body,
      },
      data: {
        type: 'notifications.updated',
        unreadCount: String(unreadCount),
        unseenCount: String(unseenCount),
        notification: JSON.stringify(notification),
        title: content.title,
        desription: content.body,
        tag: content.tag,
        renotify: String(content.renotify),
      },
      android: {
        priority: 'high',
        notification: {
          tag: content.tag,
          clickAction: 'OPEN_NOTIFICATIONS',
        },
      },
    };
  }

  private async getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
    const client = new JWT({
      email: serviceAccount.clientEmail,
      key: serviceAccount.privateKey,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });

    const { access_token: accessToken } = await client.authorize();
    if (!accessToken) {
      throw new Error('Failed to acquire Firebase access token.');
    }

    return accessToken;
  }

  private getServiceAccount(): FirebaseServiceAccount | null {
    const serviceAccountJson = this.getTrimmedConfigValue('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (serviceAccountJson) {
      try {
        const parsed = JSON.parse(serviceAccountJson) as {
          project_id?: unknown;
          client_email?: unknown;
          private_key?: unknown;
        };

        if (
          typeof parsed.project_id === 'string' &&
          typeof parsed.client_email === 'string' &&
          typeof parsed.private_key === 'string'
        ) {
          return {
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          };
        }
      } catch (error) {
        this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
      }
    }

    const projectId = this.getTrimmedConfigValue('FIREBASE_PROJECT_ID');
    const clientEmail = this.getTrimmedConfigValue('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.getTrimmedConfigValue('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }

    return {
      projectId,
      clientEmail,
      privateKey,
    };
  }

  private getTrimmedConfigValue(key: string): string | null {
    const value = this.configService.get<string>(key)?.trim();
    return value ? value : null;
  }

  private extractErrorCode(responseBody: FcmErrorResponse | null): string | null {
    const errorCode = responseBody?.error?.details?.find(
      (detail): detail is { errorCode: string } => typeof detail.errorCode === 'string',
    )?.errorCode;

    if (errorCode) {
      return errorCode;
    }

    const status = responseBody?.error?.status;
    return typeof status === 'string' ? status : null;
  }
}
