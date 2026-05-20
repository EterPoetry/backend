import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameUserDeletedAtToBlockedAt1760000028000 implements MigrationInterface {
  name = 'RenameUserDeletedAtToBlockedAt1760000028000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER INDEX "IDX_users_deleted_at" RENAME TO "IDX_users_blocked_at"`);
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "deleted_at" TO "blocked_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "blocked_at" TO "deleted_at"`);
    await queryRunner.query(`ALTER INDEX "IDX_users_blocked_at" RENAME TO "IDX_users_deleted_at"`);
  }
}
