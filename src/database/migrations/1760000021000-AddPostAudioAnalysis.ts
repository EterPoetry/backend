import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostAudioAnalysis1760000021000 implements MigrationInterface {
  name = 'AddPostAudioAnalysis1760000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."posts_audio_analysis_status_enum" AS ENUM('pending', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD "audio_analysis_status" "public"."posts_audio_analysis_status_enum" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(`
      CREATE TABLE "post_audio_analysis" (
        "post_id" integer NOT NULL,
        "version" smallint NOT NULL DEFAULT 1,
        "duration_ms" integer NOT NULL,
        "frame_ms" smallint NOT NULL,
        "features" text[] NOT NULL,
        "frames" bytea NOT NULL,
        "waveform" bytea NOT NULL,
        "accents" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "silences" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_post_audio_analysis_post_id" PRIMARY KEY ("post_id"),
        CONSTRAINT "FK_post_audio_analysis_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "post_audio_analysis"`);
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "audio_analysis_status"`);
    await queryRunner.query(`DROP TYPE "public"."posts_audio_analysis_status_enum"`);
  }
}
