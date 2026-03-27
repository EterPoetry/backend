import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMailRequestCounters1760000004000 implements MigrationInterface {
  name = 'AddMailRequestCounters1760000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mail_request_counters" (
        "mail_request_counter_id" SERIAL NOT NULL,
        "ip_address" character varying(64) NOT NULL,
        "window_type" character varying(16) NOT NULL,
        "window_start" TIMESTAMPTZ NOT NULL,
        "requests_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mail_request_counters_id" PRIMARY KEY ("mail_request_counter_id"),
        CONSTRAINT "UQ_mail_request_counters_ip_window" UNIQUE ("ip_address", "window_type", "window_start")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_mail_request_counters_ip_window_type_start"
      ON "mail_request_counters" ("ip_address", "window_type", "window_start")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_mail_request_counters_ip_window_type_start"`);
    await queryRunner.query(`DROP TABLE "mail_request_counters"`);
  }
}
