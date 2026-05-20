import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupedNotifications1760000022000 implements MigrationInterface {
  name = 'AddGroupedNotifications1760000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_post_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      RENAME COLUMN "user_id" TO "recipient_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN "notification_text"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "notification_type" TYPE character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "post_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN "last_actor_user_id" integer,
      ADD COLUMN "comment_id" integer,
      ADD COLUMN "post_complaint_id" integer,
      ADD COLUMN "group_key" character varying(255),
      ADD COLUMN "events_count" integer NOT NULL DEFAULT 1,
      ADD COLUMN "bucket_start" TIMESTAMPTZ,
      ADD COLUMN "bucket_size_minutes" integer NOT NULL DEFAULT 60,
      ADD COLUMN "last_event_at" TIMESTAMPTZ,
      ADD COLUMN "read_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      UPDATE "notifications"
      SET
        "group_key" = CONCAT('legacy:', "notification_id"),
        "bucket_start" = "created_at",
        "last_event_at" = "created_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "group_key" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "bucket_start" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "last_event_at" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "UQ_notifications_group_key" UNIQUE ("group_key")
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_recipient_user_id"
      FOREIGN KEY ("recipient_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_last_actor_user_id"
      FOREIGN KEY ("last_actor_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_post_id"
      FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_comment_id"
      FOREIGN KEY ("comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_post_complaint_id"
      FOREIGN KEY ("post_complaint_id") REFERENCES "post_complaints"("post_complaint_id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_last_event"
      ON "notifications" ("recipient_user_id", "last_event_at" DESC, "notification_id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_is_read"
      ON "notifications" ("recipient_user_id", "is_read")
    `);

    await queryRunner.query(`
      CREATE TABLE "notification_events" (
        "notification_event_id" SERIAL NOT NULL,
        "recipient_user_id" integer NOT NULL,
        "actor_user_id" integer,
        "post_id" integer,
        "comment_id" integer,
        "post_complaint_id" integer,
        "source_post_reaction_id" integer,
        "source_comment_reaction_id" integer,
        "source_follower_id" integer,
        "source_post_comment_id" integer,
        "source_post_complaint_id" integer,
        "notification_type" character varying(64) NOT NULL,
        "group_key" character varying(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_events_notification_event_id"
          PRIMARY KEY ("notification_event_id"),
        CONSTRAINT "FK_notification_events_recipient_user_id"
          FOREIGN KEY ("recipient_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_actor_user_id"
          FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL,
        CONSTRAINT "FK_notification_events_post_id"
          FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_comment_id"
          FOREIGN KEY ("comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_post_complaint_id"
          FOREIGN KEY ("post_complaint_id") REFERENCES "post_complaints"("post_complaint_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_source_post_reaction_id"
          FOREIGN KEY ("source_post_reaction_id") REFERENCES "post_reactions"("post_reaction_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_source_comment_reaction_id"
          FOREIGN KEY ("source_comment_reaction_id") REFERENCES "comment_reactions"("comment_reaction_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_source_follower_id"
          FOREIGN KEY ("source_follower_id") REFERENCES "followers"("follower_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_source_post_comment_id"
          FOREIGN KEY ("source_post_comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_events_source_post_complaint_id"
          FOREIGN KEY ("source_post_complaint_id") REFERENCES "post_complaints"("post_complaint_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notification_events_group_key"
      ON "notification_events" ("group_key")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notification_events_source_post_reaction_id"
      ON "notification_events" ("source_post_reaction_id")
      WHERE "source_post_reaction_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notification_events_source_comment_reaction_id"
      ON "notification_events" ("source_comment_reaction_id")
      WHERE "source_comment_reaction_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notification_events_source_follower_id"
      ON "notification_events" ("source_follower_id")
      WHERE "source_follower_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notification_events_post_comment_recipient_type"
      ON "notification_events" ("source_post_comment_id", "recipient_user_id", "notification_type")
      WHERE "source_post_comment_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notification_events_source_post_complaint_id"
      ON "notification_events" ("source_post_complaint_id")
      WHERE "source_post_complaint_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_events_source_post_complaint_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_events_post_comment_recipient_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_events_source_follower_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_events_source_comment_reaction_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_events_source_post_reaction_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_events_group_key"`);
    await queryRunner.query(`DROP TABLE "notification_events"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_recipient_is_read"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_recipient_last_event"`);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_post_complaint_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_comment_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_post_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_last_actor_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "FK_notifications_recipient_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "UQ_notifications_group_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN "last_actor_user_id",
      DROP COLUMN "comment_id",
      DROP COLUMN "post_complaint_id",
      DROP COLUMN "group_key",
      DROP COLUMN "events_count",
      DROP COLUMN "bucket_start",
      DROP COLUMN "bucket_size_minutes",
      DROP COLUMN "last_event_at",
      DROP COLUMN "read_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN "notification_text" text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      DELETE FROM "notifications"
      WHERE "post_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "post_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      RENAME COLUMN "recipient_user_id" TO "user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_user_id"
      FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_post_id"
      FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
    `);
  }
}
