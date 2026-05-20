import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowserPushSubscription } from './entities/browser-push-subscription.entity';
import { BrowserPushNotificationsService } from './browser-push-notifications.service';
import { NotificationEvent } from './entities/notification-event.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrowserPushSubscription, Notification, NotificationEvent]),
  ],
  controllers: [NotificationsController],
  providers: [BrowserPushNotificationsService, NotificationsService],
  exports: [TypeOrmModule, BrowserPushNotificationsService, NotificationsService],
})
export class NotificationsModule {}
