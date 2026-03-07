import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { PostCategory } from './entities/post-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Category, PostCategory])],
  exports: [TypeOrmModule],
})
export class CategoriesModule {}
