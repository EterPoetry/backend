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
  originAuthorName?: string;
  authorName?: string;
  textSnippet?: string;
  contentTitle?: string;
  contentDescription?: string;
  poemText?: string;
  poemParagraphs?: string[];
  publishedTime?: string;
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

  @ApiPropertyOptional()
  originAuthorName?: string;

  @ApiPropertyOptional()
  authorName?: string;

  @ApiPropertyOptional()
  textSnippet?: string;

  @ApiPropertyOptional()
  contentTitle?: string;

  @ApiPropertyOptional()
  contentDescription?: string;

  @ApiPropertyOptional()
  poemText?: string;

  @ApiPropertyOptional({ type: [String] })
  poemParagraphs?: string[];

  @ApiPropertyOptional()
  publishedTime?: string;
}
