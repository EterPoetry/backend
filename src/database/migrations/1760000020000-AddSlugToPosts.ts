import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlugToPosts1760000020000 implements MigrationInterface {
  name = 'AddSlugToPosts1760000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" ADD COLUMN "slug" VARCHAR(300)`);
    await queryRunner.query(`UPDATE "posts" SET "slug" = post_id::text`);
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "slug" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_posts_slug" ON "posts" ("slug")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_slug"`);
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "slug"`);
  }
}
