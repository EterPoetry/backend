import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostStatusAndNullableContent1760000006000 implements MigrationInterface {
  name = 'AddPostStatusAndNullableContent1760000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'published')`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD "status" "public"."posts_status_enum" NOT NULL DEFAULT 'draft'`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "title" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "text" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "text" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "title" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum"`);
  }
}
