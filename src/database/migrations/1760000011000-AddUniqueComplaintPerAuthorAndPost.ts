import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueComplaintPerAuthorAndPost1760000011000
  implements MigrationInterface
{
  name = 'AddUniqueComplaintPerAuthorAndPost1760000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "post_complaints"
      WHERE "post_complaint_id" IN (
        SELECT duplicate."post_complaint_id"
        FROM (
          SELECT
            "post_complaint_id",
            ROW_NUMBER() OVER (
              PARTITION BY "author_id", "target_post_id"
              ORDER BY "created_at" ASC, "post_complaint_id" ASC
            ) AS row_number
          FROM "post_complaints"
        ) AS duplicate
        WHERE duplicate.row_number > 1
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "post_complaints"
      ADD CONSTRAINT "UQ_post_complaints_author_post"
      UNIQUE ("author_id", "target_post_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "post_complaints"
      DROP CONSTRAINT "UQ_post_complaints_author_post"
    `);
  }
}
