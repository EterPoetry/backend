import { Injectable } from '@nestjs/common';
import { COMPLAINT_REASON_LABELS } from '../common/enums/complaint-reason.enum';
import { NotificationType } from './notification-type.enum';
import { NotificationResponse } from './notifications.service';

export interface PushMessageContent {
  title: string;
  body: string;
  tag: string;
  renotify: boolean;
}

@Injectable()
export class PushNotificationContentService {
  build(notification: NotificationResponse): PushMessageContent {
    const actor = notification.lastActor?.name
      ? `Користувач ${notification.lastActor.name}`
      : 'Користувач';

    switch (notification.notificationType) {
      case NotificationType.POST_LIKED:
        return {
          title: notification.eventsCount > 1 ? 'Нові вподобайки' : 'Нова вподобайка',
          body:
            notification.eventsCount > 1
              ? `${actor} та ще ${notification.eventsCount - 1} інших вподобали ваш пост.`
              : `${actor} вподобав ваш пост.`,
          tag: `notification:${notification.notificationId}`,
          renotify: notification.eventsCount > 1,
        };
      case NotificationType.POST_COMMENTED:
        return {
          title: notification.eventsCount > 1 ? 'Нові коментарі' : 'Новий коментар',
          body:
            notification.eventsCount > 1
              ? `${actor} та ще ${notification.eventsCount - 1} інших прокоментували ваш пост.`
              : `${actor} прокоментував ваш пост.`,
          tag: `notification:${notification.notificationId}`,
          renotify: notification.eventsCount > 1,
        };
      case NotificationType.COMMENT_REPLIED:
        return {
          title: notification.eventsCount > 1 ? 'Нові відповіді' : 'Нова відповідь',
          body:
            notification.eventsCount > 1
              ? `${actor} та ще ${notification.eventsCount - 1} інших відповіли на ваш коментар.`
              : `${actor} відповів на ваш коментар.`,
          tag: `notification:${notification.notificationId}`,
          renotify: notification.eventsCount > 1,
        };
      case NotificationType.COMMENT_LIKED:
        return {
          title: notification.eventsCount > 1 ? 'Нові вподобайки коментаря' : 'Нова вподобайка коментаря',
          body:
            notification.eventsCount > 1
              ? `${actor} та ще ${notification.eventsCount - 1} інших вподобали ваш коментар.`
              : `${actor} вподобав ваш коментар.`,
          tag: `notification:${notification.notificationId}`,
          renotify: notification.eventsCount > 1,
        };
      case NotificationType.USER_FOLLOWED:
        return {
          title: notification.eventsCount > 1 ? 'Нові підписники' : 'Новий підписник',
          body:
            notification.eventsCount > 1
              ? `${actor} та ще ${notification.eventsCount - 1} інших підписалися на вас.`
              : `${actor} підписався на вас.`,
          tag: `notification:${notification.notificationId}`,
          renotify: notification.eventsCount > 1,
        };
      case NotificationType.POST_VIOLATION_CONFIRMED:
        return {
          title: 'Ваш пост порушує наші правила',
          body: notification.violationReason
            ? `Скаргу на ваш пост підтверджено. Причина: ${COMPLAINT_REASON_LABELS[notification.violationReason]}`
            : 'Скаргу на ваш пост підтверджено.',
          tag: `notification:${notification.notificationId}`,
          renotify: false,
        };
      case NotificationType.POST_VIOLATION_REMOVED:
        return {
          title: 'Порушення знято',
          body: 'Порушення на ваш пост було скасовано, і пост відновлено.',
          tag: `notification:${notification.notificationId}`,
          renotify: false,
        };
    }
  }
}
