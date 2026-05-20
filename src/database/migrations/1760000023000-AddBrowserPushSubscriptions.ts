import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrowserPushSubscriptions1760000023000 implements MigrationInterface {
  name = 'AddBrowserPushSubscriptions1760000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "browser_push_subscriptions" (
        "browser_push_subscription_id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "endpoint" character varying(1000) NOT NULL,
        "p256dh_key" character varying(255) NOT NULL,
        "auth_key" character varying(255) NOT NULL,
        "expiration_time" TIMESTAMPTZ,
        "user_agent" character varying(1000),
        "last_success_at" TIMESTAMPTZ,
        "last_failure_at" TIMESTAMPTZ,
        "last_failure_status_code" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_browser_push_subscriptions_browser_push_subscription_id"
          PRIMARY KEY ("browser_push_subscription_id"),
        CONSTRAINT "UQ_browser_push_subscriptions_endpoint" UNIQUE ("endpoint"),
        CONSTRAINT "FK_browser_push_subscriptions_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_browser_push_subscriptions_user_id"
      ON "browser_push_subscriptions" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_browser_push_subscriptions_user_id"`);
    await queryRunner.query(`DROP TABLE "browser_push_subscriptions"`);
  }
}
