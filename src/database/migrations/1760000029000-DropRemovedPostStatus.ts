import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropRemovedPostStatus1760000029000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "posts" SET "status" = 'published' WHERE "status" = 'removed'`);

    await queryRunner.query(
      `ALTER TYPE "public"."posts_status_enum" RENAME TO "posts_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'processing', 'published')`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum" USING "status"::text::"public"."posts_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."posts_status_enum" RENAME TO "posts_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'processing', 'published', 'removed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum" USING "status"::text::"public"."posts_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum_old"`);

    await queryRunner.query(
      `UPDATE "posts" SET "status" = 'removed' WHERE "removed_at" IS NOT NULL`,
    );
  }
}
