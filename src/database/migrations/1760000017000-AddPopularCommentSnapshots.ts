import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPopularCommentSnapshots1760000017000 implements MigrationInterface {
  name = 'AddPopularCommentSnapshots1760000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "popular_comment_snapshots" (
        "snapshot_id" SERIAL NOT NULL,
        "post_id" integer NOT NULL,
        "reply_to_comment_id" integer,
        "generated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMPTZ NOT NULL,
        "total_comments" integer NOT NULL,
        CONSTRAINT "PK_popular_comment_snapshots_snapshot_id" PRIMARY KEY ("snapshot_id"),
        CONSTRAINT "FK_popular_comment_snapshots_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_popular_comment_snapshots_reply_to_comment_id" FOREIGN KEY ("reply_to_comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "popular_comment_snapshot_items" (
        "snapshot_item_id" SERIAL NOT NULL,
        "snapshot_id" integer NOT NULL,
        "comment_id" integer NOT NULL,
        "rank" integer NOT NULL,
        "likes_count" integer NOT NULL,
        CONSTRAINT "PK_popular_comment_snapshot_items_snapshot_item_id" PRIMARY KEY ("snapshot_item_id"),
        CONSTRAINT "FK_popular_comment_snapshot_items_snapshot_id" FOREIGN KEY ("snapshot_id") REFERENCES "popular_comment_snapshots"("snapshot_id") ON DELETE CASCADE,
        CONSTRAINT "FK_popular_comment_snapshot_items_comment_id" FOREIGN KEY ("comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_popular_comment_snapshot_items_snapshot_rank"
      ON "popular_comment_snapshot_items" ("snapshot_id", "rank")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_popular_comment_snapshot_items_snapshot_comment"
      ON "popular_comment_snapshot_items" ("snapshot_id", "comment_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_popular_comment_snapshots_scope_generated_at"
      ON "popular_comment_snapshots" ("post_id", "reply_to_comment_id", "generated_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_popular_comment_snapshots_scope_generated_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_popular_comment_snapshot_items_snapshot_comment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_popular_comment_snapshot_items_snapshot_rank"`);
    await queryRunner.query(`DROP TABLE "popular_comment_snapshot_items"`);
    await queryRunner.query(`DROP TABLE "popular_comment_snapshots"`);
  }
}
