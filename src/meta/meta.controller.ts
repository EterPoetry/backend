import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { extractPostIdFromSlug } from '../posts/post-slug.util';
import { PageMetaResponseDto } from './dto/page-meta-response.dto';
import { MetaService } from './meta.service';

@Controller('meta')
@ApiTags('Meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('posts/:slug')
  @ApiOkResponse({ type: PageMetaResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  async getPostMeta(@Param('slug') slug: string): Promise<PageMetaResponseDto> {
    const postId = extractPostIdFromSlug(slug);
    if (!postId) {
      throw new BadRequestException('Invalid post identifier.');
    }
    return this.metaService.getPostMeta(postId);
  }

  @Get('profiles/:username')
  @ApiOkResponse({ type: PageMetaResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  async getProfileMeta(@Param('username') username: string): Promise<PageMetaResponseDto> {
    return this.metaService.getProfileMetaByUsername(username);
  }
}
