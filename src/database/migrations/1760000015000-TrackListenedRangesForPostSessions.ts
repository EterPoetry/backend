import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackListenedRangesForPostSessions1760000015000
  implements MigrationInterface
{
  name = 'TrackListenedRangesForPostSessions1760000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "post_listen_sessions"
      ADD "listened_ranges" jsonb NOT NULL DEFAULT '[]'
    `);
    await queryRunner.query(`
      ALTER TABLE "post_listen_sessions"
      ADD "consecutive_anomaly_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "post_listen_sessions"
      SET "listened_ranges" = CASE
        WHEN LEAST("track_duration_ms", GREATEST("listened_ms", "max_position_ms")) > 0
          THEN jsonb_build_array(
            jsonb_build_object(
              'startMs', 0,
              'endMs', LEAST("track_duration_ms", GREATEST("listened_ms", "max_position_ms"))
            )
          )
        ELSE '[]'::jsonb
      END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "post_listen_sessions"
      DROP COLUMN "consecutive_anomaly_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "post_listen_sessions"
      DROP COLUMN "listened_ranges"
    `);
  }
}
