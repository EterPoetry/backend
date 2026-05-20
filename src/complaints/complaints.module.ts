import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/entities/post.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PostComplaint } from './entities/post-complaint.entity';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';

@Module({
  imports: [TypeOrmModule.forFeature([PostComplaint, Post]), NotificationsModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [TypeOrmModule, ComplaintsService],
})
export class ComplaintsModule {}
