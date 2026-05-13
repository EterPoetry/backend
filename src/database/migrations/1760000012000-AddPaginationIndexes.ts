import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaginationIndexes1760000012000 implements MigrationInterface {
  name = 'AddPaginationIndexes1760000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_posts_author_status_created_post" ON "posts" ("author_id", "status", "created_at" DESC, "post_id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_posts_author_updated_post" ON "posts" ("author_id", "updated_at" DESC, "post_id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_post_comments_post_reply_comment" ON "post_comments" ("post_id", "reply_to_comment_id", "post_comment_id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_post_comments_reply_comment" ON "post_comments" ("reply_to_comment_id", "post_comment_id" ASC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_followers_target_created_follower" ON "followers" ("target_user_id", "created_at" DESC, "follower_user_id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_followers_follower_created_target" ON "followers" ("follower_user_id", "created_at" DESC, "target_user_id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_followers_follower_created_target"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_followers_target_created_follower"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_post_comments_reply_comment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_post_comments_post_reply_comment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_author_updated_post"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_author_status_created_post"`);
  }
}
