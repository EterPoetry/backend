import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEvent } from './entities/notification-event.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, NotificationEvent])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
