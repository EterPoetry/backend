import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledComplaintStatus1760000030000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."post_complaints_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "post_complaints" SET "status" = 'resolved' WHERE "status" = 'cancelled'`);

    await queryRunner.query(
      `ALTER TYPE "public"."post_complaints_status_enum" RENAME TO "post_complaints_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."post_complaints_status_enum" AS ENUM('pending', 'resolved', 'dismissed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_complaints" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_complaints" ALTER COLUMN "status" TYPE "public"."post_complaints_status_enum" USING "status"::text::"public"."post_complaints_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."post_complaints_status_enum_old"`);
  }
}
