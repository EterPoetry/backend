import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAndroidPushTokens1760000031000 implements MigrationInterface {
  name = 'AddAndroidPushTokens1760000031000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "android_push_tokens" (
        "android_push_token_id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "token" character varying(4096) NOT NULL,
        "device_id" character varying(255),
        "app_version" character varying(64),
        "last_success_at" TIMESTAMPTZ,
        "last_failure_at" TIMESTAMPTZ,
        "last_failure_code" character varying(128),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_android_push_tokens_android_push_token_id"
          PRIMARY KEY ("android_push_token_id"),
        CONSTRAINT "UQ_android_push_tokens_token" UNIQUE ("token"),
        CONSTRAINT "FK_android_push_tokens_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_android_push_tokens_user_id"
      ON "android_push_tokens" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_android_push_tokens_user_id"`);
    await queryRunner.query(`DROP TABLE "android_push_tokens"`);
  }
}
