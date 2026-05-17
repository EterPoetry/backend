import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
  ) {}

  async blockUser(userId: number): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    await this.usersRepository.softDelete({ userId });
    await this.refreshTokensRepository.update(
      {
        userId,
        revokedAt: IsNull(),
      },
      { revokedAt: new Date() },
    );
  }

  async unblockUser(userId: number): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      withDeleted: true,
    });

    if (!user?.deletedAt) {
      throw new NotFoundException('Blocked user not found.');
    }

    await this.usersRepository.restore(userId);
  }
}
