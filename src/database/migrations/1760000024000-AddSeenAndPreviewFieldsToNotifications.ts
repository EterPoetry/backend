import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeenAndPreviewFieldsToNotifications1760000024000
  implements MigrationInterface
{
  name = 'AddSeenAndPreviewFieldsToNotifications1760000024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN "is_seen" boolean NOT NULL DEFAULT false,
      ADD COLUMN "seen_at" TIMESTAMPTZ,
      ADD COLUMN "preview_text" text
    `);
    await queryRunner.query(`
      UPDATE "notifications"
      SET
        "is_seen" = "is_read",
        "seen_at" = "read_at"
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_is_seen"
      ON "notifications" ("recipient_user_id", "is_seen")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_recipient_is_seen"`);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN "preview_text",
      DROP COLUMN "seen_at",
      DROP COLUMN "is_seen"
    `);
  }
}
