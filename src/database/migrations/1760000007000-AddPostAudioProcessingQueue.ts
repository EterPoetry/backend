import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostAudioProcessingQueue1760000007000 implements MigrationInterface {
  name = 'AddPostAudioProcessingQueue1760000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."posts_status_enum" RENAME TO "posts_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'processing', 'published')`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum" USING "status"::text::"public"."posts_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'draft'`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum_old"`);

    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "audio_file_name" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "posts" ADD "source_audio_file_name" character varying(300)`);

    await queryRunner.query(
      `CREATE TYPE "public"."post_audio_processing_jobs_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "post_audio_processing_jobs" (
        "post_audio_processing_job_id" SERIAL NOT NULL,
        "post_id" integer NOT NULL,
        "status" "public"."post_audio_processing_jobs_status_enum" NOT NULL DEFAULT 'pending',
        "source_audio_file_name" character varying(300) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "locked_at" TIMESTAMPTZ,
        "last_error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_post_audio_processing_jobs_id" PRIMARY KEY ("post_audio_processing_job_id"),
        CONSTRAINT "UQ_post_audio_processing_jobs_post_id" UNIQUE ("post_id"),
        CONSTRAINT "FK_post_audio_processing_jobs_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_post_audio_processing_jobs_status_created_at" ON "post_audio_processing_jobs" ("status", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_post_audio_processing_jobs_status_created_at"`);
    await queryRunner.query(`DROP TABLE "post_audio_processing_jobs"`);
    await queryRunner.query(`DROP TYPE "public"."post_audio_processing_jobs_status_enum"`);

    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "source_audio_file_name"`);
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "audio_file_name" SET NOT NULL`);

    await queryRunner.query(`ALTER TYPE "public"."posts_status_enum" RENAME TO "posts_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'published')`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum" USING CASE WHEN "status"::text = 'processing' THEN 'draft' ELSE "status"::text END::"public"."posts_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'draft'`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum_old"`);
  }
}
