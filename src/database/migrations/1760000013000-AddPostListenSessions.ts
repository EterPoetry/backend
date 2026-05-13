import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostListenSessions1760000013000 implements MigrationInterface {
  name = 'AddPostListenSessions1760000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "post_listen_sessions" (
        "post_listen_session_id" SERIAL NOT NULL,
        "post_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "client_session_id" character varying(120) NOT NULL,
        "track_duration_ms" integer NOT NULL,
        "listened_ms" integer NOT NULL DEFAULT 0,
        "max_position_ms" integer NOT NULL DEFAULT 0,
        "last_position_ms" integer,
        "last_progress_at" TIMESTAMPTZ,
        "ended_at" TIMESTAMPTZ,
        "listen_counted_at" TIMESTAMPTZ,
        "is_suspicious" boolean NOT NULL DEFAULT false,
        "suspicious_reason" character varying(200),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_post_listen_sessions_id" PRIMARY KEY ("post_listen_session_id"),
        CONSTRAINT "UQ_post_listen_sessions_post_user_client_session" UNIQUE ("post_id", "user_id", "client_session_id"),
        CONSTRAINT "FK_post_listen_sessions_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_listen_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_user_counted_at"
      ON "post_listen_sessions" ("post_id", "user_id", "listen_counted_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_user_created_at"
      ON "post_listen_sessions" ("post_id", "user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_suspicious_created_at"
      ON "post_listen_sessions" ("is_suspicious", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_post_listen_sessions_suspicious_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_post_listen_sessions_post_user_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_post_listen_sessions_post_user_counted_at"`);
    await queryRunner.query(`DROP TABLE "post_listen_sessions"`);
  }
}
