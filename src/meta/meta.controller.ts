import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PageMetaResponseDto } from './dto/page-meta-response.dto';
import { MetaService } from './meta.service';

@Controller('api/meta')
@ApiTags('Meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('posts/:postId')
  @ApiOkResponse({ type: PageMetaResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  async getPostMeta(@Param('postId', ParseIntPipe) postId: number): Promise<PageMetaResponseDto> {
    return this.metaService.getPostMeta(postId);
  }

  @Get('profiles/:userId')
  @ApiOkResponse({ type: PageMetaResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  async getProfileMeta(@Param('userId', ParseIntPipe) userId: number): Promise<PageMetaResponseDto> {
    return this.metaService.getProfileMeta(userId);
  }
}
