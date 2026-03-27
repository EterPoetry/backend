import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetRequestedAtToUsers1760000005000
  implements MigrationInterface
{
  name = 'AddPasswordResetRequestedAtToUsers1760000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "password_reset_requested_at" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "password_reset_requested_at"`,
    );
  }
}
