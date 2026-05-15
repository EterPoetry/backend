import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPopularPostSnapshots1760000016000 implements MigrationInterface {
  name = 'AddPopularPostSnapshots1760000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "popular_post_snapshots" (
        "snapshot_id" SERIAL NOT NULL,
        "generated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMPTZ NOT NULL,
        "total_posts" integer NOT NULL,
        CONSTRAINT "PK_popular_post_snapshots_snapshot_id" PRIMARY KEY ("snapshot_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "popular_post_snapshot_items" (
        "snapshot_item_id" SERIAL NOT NULL,
        "snapshot_id" integer NOT NULL,
        "post_id" integer NOT NULL,
        "rank" integer NOT NULL,
        "score" double precision NOT NULL,
        CONSTRAINT "PK_popular_post_snapshot_items_snapshot_item_id" PRIMARY KEY ("snapshot_item_id"),
        CONSTRAINT "FK_popular_post_snapshot_items_snapshot_id" FOREIGN KEY ("snapshot_id") REFERENCES "popular_post_snapshots"("snapshot_id") ON DELETE CASCADE,
        CONSTRAINT "FK_popular_post_snapshot_items_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_popular_post_snapshot_items_snapshot_rank"
      ON "popular_post_snapshot_items" ("snapshot_id", "rank")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_popular_post_snapshot_items_snapshot_post"
      ON "popular_post_snapshot_items" ("snapshot_id", "post_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_popular_post_snapshots_generated_at"
      ON "popular_post_snapshots" ("generated_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_popular_post_snapshots_generated_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_popular_post_snapshot_items_snapshot_post"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_popular_post_snapshot_items_snapshot_rank"`);
    await queryRunner.query(`DROP TABLE "popular_post_snapshot_items"`);
    await queryRunner.query(`DROP TABLE "popular_post_snapshots"`);
  }
}
