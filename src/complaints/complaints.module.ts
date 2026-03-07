import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostComplaint } from './entities/post-complaint.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PostComplaint])],
  exports: [TypeOrmModule],
})
export class ComplaintsModule {}
