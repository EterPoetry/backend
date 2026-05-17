import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteToUsers1760000019000 implements MigrationInterface {
  name = 'AddSoftDeleteToUsers1760000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_deleted_at" ON "users" ("deleted_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_users_deleted_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "deleted_at"`,
    );
  }
}
