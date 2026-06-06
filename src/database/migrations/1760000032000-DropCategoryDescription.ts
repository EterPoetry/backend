import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCategoryDescription1760000032000 implements MigrationInterface {
  name = 'DropCategoryDescription1760000032000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "category_description"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" ADD "category_description" text`);
  }
}
