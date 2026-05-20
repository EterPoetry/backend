import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowserPushSubscription } from './entities/browser-push-subscription.entity';
import { PushNotificationSettings } from './entities/push-notification-settings.entity';
import { BrowserPushNotificationsService } from './browser-push-notifications.service';
import { NotificationEvent } from './entities/notification-event.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrowserPushSubscription, PushNotificationSettings, Notification, NotificationEvent]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [BrowserPushNotificationsService, NotificationsGateway, NotificationsService],
  exports: [TypeOrmModule, BrowserPushNotificationsService, NotificationsService],
})
export class NotificationsModule {}
