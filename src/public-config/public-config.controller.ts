import { Controller, Get } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { PublicConfigResponse, PublicConfigService } from './public-config.service';

class RecordingConfigDto {
  @ApiProperty()
  freeDurationLimitMinutes: number;

  @ApiProperty()
  premiumDurationLimitMinutes: number;
}

class SubscriptionConfigDto {
  @ApiProperty()
  priceUsd: number;
}

class PublicConfigResponseDto implements PublicConfigResponse {
  @ApiProperty({ type: RecordingConfigDto })
  recording: RecordingConfigDto;

  @ApiProperty({ type: SubscriptionConfigDto })
  subscription: SubscriptionConfigDto;
}

@Controller('config')
export class PublicConfigController {
  constructor(private readonly publicConfigService: PublicConfigService) {}

  @Get()
  getConfig(): PublicConfigResponseDto {
    return this.publicConfigService.getPublicConfig();
  }
}
