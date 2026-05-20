import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushNotificationSettings1760000025000
  implements MigrationInterface
{
  name = 'AddPushNotificationSettings1760000025000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_notification_settings" (
        "push_notification_settings_id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL UNIQUE,
        "disabled_types" text[] NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_push_notification_settings_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "push_notification_settings"`);
  }
}
