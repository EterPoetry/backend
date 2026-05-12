import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizePostReactionsToLike1760000010000 implements MigrationInterface {
  name = 'NormalizePostReactionsToLike1760000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "post_reactions"
      SET "reaction_type" = 'touched'
      WHERE "reaction_type" <> 'touched'
    `);
    await queryRunner.query(`
      ALTER TYPE "public"."post_reactions_reaction_type_enum"
      RENAME TO "post_reactions_reaction_type_enum_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."post_reactions_reaction_type_enum" AS ENUM('like')
    `);
    await queryRunner.query(`
      ALTER TABLE "post_reactions"
      ALTER COLUMN "reaction_type"
      TYPE "public"."post_reactions_reaction_type_enum"
      USING (
        CASE
          WHEN "reaction_type"::text = 'touched' THEN 'like'
          ELSE 'like'
        END
      )::"public"."post_reactions_reaction_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "public"."post_reactions_reaction_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."post_reactions_reaction_type_enum"
      RENAME TO "post_reactions_reaction_type_enum_new"
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."post_reactions_reaction_type_enum" AS ENUM('touched', 'strong', 'quiet')
    `);
    await queryRunner.query(`
      ALTER TABLE "post_reactions"
      ALTER COLUMN "reaction_type"
      TYPE "public"."post_reactions_reaction_type_enum"
      USING 'touched'::"public"."post_reactions_reaction_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "public"."post_reactions_reaction_type_enum_new"`);
  }
}
