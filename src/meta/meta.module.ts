import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/entities/post.entity';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';

@Module({
  imports: [TypeOrmModule.forFeature([Post, User]), StorageModule],
  controllers: [MetaController],
  providers: [MetaService],
})
export class MetaModule {}
