import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminModerationFoundation1760000027000 implements MigrationInterface {
  name = 'AddAdminModerationFoundation1760000027000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."admins_role_enum" AS ENUM('admin', 'global_admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD "role" "public"."admins_role_enum" NOT NULL DEFAULT 'admin'`,
    );
    await queryRunner.query(
      `UPDATE "admins" SET "role" = CASE WHEN "is_global_admin" = true THEN 'global_admin' ELSE 'admin' END::"public"."admins_role_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "is_global_admin"`);
    await queryRunner.query(`ALTER TABLE "admins" ALTER COLUMN "password" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "admins" ADD "invite_token_hash" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "admins" ADD "invite_expires_at" TIMESTAMPTZ`);

    await queryRunner.query(`
      CREATE TABLE "admin_refresh_tokens" (
        "admin_refresh_token_id" SERIAL NOT NULL,
        "admin_id" integer NOT NULL,
        "token_hash" character varying(128) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_refresh_tokens_admin_refresh_token_id" PRIMARY KEY ("admin_refresh_token_id"),
        CONSTRAINT "UQ_admin_refresh_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_admin_refresh_tokens_admin_id" FOREIGN KEY ("admin_id") REFERENCES "admins"("admin_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_refresh_tokens_admin_id" ON "admin_refresh_tokens" ("admin_id")`,
    );

    await queryRunner.query(`ALTER TYPE "public"."posts_status_enum" RENAME TO "posts_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'processing', 'published', 'removed')`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum" USING "status"::text::"public"."posts_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'draft'`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum_old"`);
    await queryRunner.query(`ALTER TABLE "posts" ADD "published_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "posts" ADD "removed_at" TIMESTAMPTZ`);
    await queryRunner.query(
      `UPDATE "posts" SET "published_at" = "created_at" WHERE "status" = 'published'`,
    );

    await queryRunner.query(`ALTER TABLE "post_complaints" ADD "processed_at" TIMESTAMPTZ`);
    await queryRunner.query(
      `UPDATE "post_complaints" SET "processed_at" = "created_at" WHERE "status" IN ('resolved', 'dismissed')`,
    );

    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "UQ_categories_category_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_categories_category_name_lower" ON "categories" (LOWER("category_name"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_categories_category_name_lower"`);
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "UQ_categories_category_name" UNIQUE ("category_name")`,
    );

    await queryRunner.query(`ALTER TABLE "post_complaints" DROP COLUMN "processed_at"`);

    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "removed_at"`);
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "published_at"`);
    await queryRunner.query(`ALTER TYPE "public"."posts_status_enum" RENAME TO "posts_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'processing', 'published')`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum" USING CASE WHEN "status"::text = 'removed' THEN 'draft' ELSE "status"::text END::"public"."posts_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'draft'`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum_old"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_admin_refresh_tokens_admin_id"`);
    await queryRunner.query(`DROP TABLE "admin_refresh_tokens"`);

    await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "invite_expires_at"`);
    await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "invite_token_hash"`);
    await queryRunner.query(`ALTER TABLE "admins" ALTER COLUMN "password" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "admins" ADD "is_global_admin" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `UPDATE "admins" SET "is_global_admin" = CASE WHEN "role" = 'global_admin' THEN true ELSE false END`,
    );
    await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "public"."admins_role_enum"`);
  }
}
