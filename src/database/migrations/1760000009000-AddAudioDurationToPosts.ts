import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAudioDurationToPosts1760000009000 implements MigrationInterface {
  name = 'AddAudioDurationToPosts1760000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" ADD "audio_duration_seconds" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "audio_duration_seconds"`);
  }
}
