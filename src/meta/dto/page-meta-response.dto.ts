import { ApiProperty } from '@nestjs/swagger';

export interface PageMetaResponse {
  title: string;
  description: string;
  image: string;
  url: string;
  canonical: string;
  type: 'article' | 'profile';
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
}
