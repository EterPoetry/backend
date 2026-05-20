import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';
import { NotificationType } from '../notification-type.enum';

export class UpdatePushSettingsDto {
  @ApiProperty({
    enum: NotificationType,
    enumName: 'NotificationType',
    isArray: true,
    description: 'Notification types that should not trigger push notifications.',
  })
  @IsArray()
  @IsEnum(NotificationType, { each: true })
  disabledTypes: NotificationType[];
}
