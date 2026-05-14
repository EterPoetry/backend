import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnonymousPostListenTracking1760000014000 implements MigrationInterface {
  name = 'AddAnonymousPostListenTracking1760000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_post_user_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_post_user_counted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" DROP CONSTRAINT "UQ_post_listen_sessions_post_user_client_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" ALTER COLUMN "user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" ADD "guest_session_id" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" ADD "fingerprint_hash" character varying(64)`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_post_listen_sessions_post_user_client_session"
      ON "post_listen_sessions" ("post_id", "user_id", "client_session_id")
      WHERE "user_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_post_listen_sessions_post_guest_client_session"
      ON "post_listen_sessions" ("post_id", "guest_session_id", "client_session_id")
      WHERE "guest_session_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_user_counted_at"
      ON "post_listen_sessions" ("post_id", "user_id", "listen_counted_at" DESC)
      WHERE "user_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_guest_counted_at"
      ON "post_listen_sessions" ("post_id", "guest_session_id", "listen_counted_at" DESC)
      WHERE "guest_session_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_fingerprint_counted_at"
      ON "post_listen_sessions" ("post_id", "fingerprint_hash", "listen_counted_at" DESC)
      WHERE "fingerprint_hash" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_fingerprint_created_at"
      ON "post_listen_sessions" ("fingerprint_hash", "created_at" DESC)
      WHERE "fingerprint_hash" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_user_created_at"
      ON "post_listen_sessions" ("post_id", "user_id", "created_at" DESC)
      WHERE "user_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_post_user_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_fingerprint_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_post_fingerprint_counted_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_post_guest_counted_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_post_listen_sessions_post_user_counted_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_post_listen_sessions_post_guest_client_session"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_post_listen_sessions_post_user_client_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" DROP COLUMN "fingerprint_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" DROP COLUMN "guest_session_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_listen_sessions" ALTER COLUMN "user_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "post_listen_sessions"
      ADD CONSTRAINT "UQ_post_listen_sessions_post_user_client_session"
      UNIQUE ("post_id", "user_id", "client_session_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_user_counted_at"
      ON "post_listen_sessions" ("post_id", "user_id", "listen_counted_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_listen_sessions_post_user_created_at"
      ON "post_listen_sessions" ("post_id", "user_id", "created_at" DESC)
    `);
  }
}
