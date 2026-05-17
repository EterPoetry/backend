import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PageMetaResponseDto } from './dto/page-meta-response.dto';
import { MetaService } from './meta.service';

@Controller('meta')
@ApiTags('Meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('posts/:postId')
  @ApiOkResponse({ type: PageMetaResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  async getPostMeta(@Param('postId', ParseIntPipe) postId: number): Promise<PageMetaResponseDto> {
    return this.metaService.getPostMeta(postId);
  }

  @Get('profiles/:username')
  @ApiOkResponse({ type: PageMetaResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  async getProfileMeta(@Param('username') username: string): Promise<PageMetaResponseDto> {
    return this.metaService.getProfileMetaByUsername(username);
  }
}
