import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetToUsers1760000002000 implements MigrationInterface {
  name = 'AddPasswordResetToUsers1760000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "reset_password_token_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "reset_password_expires_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_reset_password_token_hash" ON "users" ("reset_password_token_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_users_reset_password_token_hash"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "reset_password_expires_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "reset_password_token_hash"`);
  }
}
