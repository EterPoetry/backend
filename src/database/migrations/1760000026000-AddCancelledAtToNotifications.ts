import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledAtToNotifications1760000026000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN "cancelled_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN "cancelled_at"
    `);
  }
}
