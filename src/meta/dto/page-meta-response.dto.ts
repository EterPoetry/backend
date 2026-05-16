import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface PageMetaResponse {
  title: string;
  description: string;
  image: string;
  url: string;
  canonical: string;
  type: 'article' | 'profile';
  audioFileUrl?: string;
  audioMimeType?: string;
  audioDurationSeconds?: number;
}

export class PageMetaResponseDto implements PageMetaResponse {
  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  image: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  canonical: string;

  @ApiProperty({ enum: ['article', 'profile'] })
  type: 'article' | 'profile';

  @ApiPropertyOptional()
  audioFileUrl?: string;

  @ApiPropertyOptional()
  audioMimeType?: string;

  @ApiPropertyOptional()
  audioDurationSeconds?: number;
}
