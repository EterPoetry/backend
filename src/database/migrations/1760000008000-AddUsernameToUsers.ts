import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsernameToUsers1760000008000 implements MigrationInterface {
  name = 'AddUsernameToUsers1760000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "username" character varying(30)`);
    await queryRunner.query(`
      WITH prepared AS (
        SELECT
          "user_id",
          lower(
            COALESCE(
              NULLIF(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9]+', '', 'g'), ''),
              NULLIF(regexp_replace("name", '[^a-zA-Z0-9]+', '', 'g'), ''),
              'user'
            )
          ) AS base_username
        FROM "users"
      )
      UPDATE "users" AS users
      SET "username" = CASE
        WHEN length(prepared.base_username) >= 3
          THEN left(
            prepared.base_username,
            GREATEST(3, 30 - length(users."user_id"::text) - 1)
          ) || '_' || users."user_id"::text
        ELSE 'user_' || users."user_id"::text
      END
      FROM prepared
      WHERE prepared."user_id" = users."user_id"
    `);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_username" UNIQUE ("username")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_users_username"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}
