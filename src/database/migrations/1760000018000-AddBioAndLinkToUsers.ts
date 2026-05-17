import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBioAndLinkToUsers1760000018000 implements MigrationInterface {
  name = 'AddBioAndLinkToUsers1760000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "bio" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "link" character varying(500)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "link"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bio"`);
  }
}
