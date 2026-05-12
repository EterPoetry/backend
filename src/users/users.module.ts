import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsernameService } from './username.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsernameService],
  exports: [TypeOrmModule, UsernameService],
})
export class UsersModule {}
