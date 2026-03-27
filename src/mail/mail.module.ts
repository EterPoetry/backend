import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailjetService } from './mailjet.service';
import { MailRequestCounter } from './entities/mail-request-counter.entity';
import { MailRequestLimitService } from './mail-request-limit.service';
import { RateLimitedMailService } from './rate-limited-mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([MailRequestCounter])],
  providers: [MailjetService, MailRequestLimitService, RateLimitedMailService],
  exports: [RateLimitedMailService],
})
export class MailModule {}
