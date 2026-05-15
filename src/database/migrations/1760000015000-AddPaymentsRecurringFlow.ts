import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentsRecurringFlow1760000015000 implements MigrationInterface {
  name = 'AddPaymentsRecurringFlow1760000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."subscriptions_status_enum" RENAME TO "subscriptions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('created', 'active', 'past_due', 'cancelled', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions"
        ALTER COLUMN "status" TYPE "public"."subscriptions_status_enum"
        USING (
          CASE
            WHEN "status"::text = 'active' THEN 'active'
            WHEN "status"::text = 'cancelled' THEN 'cancelled'
            WHEN "status"::text = 'expired' THEN 'expired'
            ELSE 'created'
          END
        )::"public"."subscriptions_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum_old"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "start_date" DROP NOT NULL`);

    await queryRunner.query(
      `ALTER TYPE "public"."transactions_status_enum" RENAME TO "transactions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_status_enum" AS ENUM('created', 'processing', 'hold', 'success', 'failure', 'reversed', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions"
        ALTER COLUMN "status" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions"
        ALTER COLUMN "status" TYPE "public"."transactions_status_enum"
        USING (
          CASE
            WHEN "status"::text = 'pending' THEN 'processing'
            WHEN "status"::text = 'failed' THEN 'failure'
            WHEN "status"::text = 'refunded' THEN 'reversed'
            WHEN "status"::text = 'success' THEN 'success'
            ELSE NULL
          END
        )::"public"."transactions_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_status_enum_old"`);

    await queryRunner.query(
      `ALTER TYPE "public"."transactions_type_enum" RENAME TO "transactions_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_type_enum" AS ENUM('charge', 'hold', 'refund')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions"
        ALTER COLUMN "type" TYPE "public"."transactions_type_enum"
        USING (
          CASE
            WHEN "type"::text = 'refund' THEN 'refund'
            ELSE 'charge'
          END
        )::"public"."transactions_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_type_enum_old"`);

    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "amount" numeric(10,2)`,
    );
    await queryRunner.query(
      `UPDATE "transactions" SET "amount" = "sum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "modified_date" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `UPDATE "transactions" SET "modified_date" = "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "is_card_updating" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "is_card_updating"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "modified_date"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "amount"`);

    await queryRunner.query(
      `ALTER TYPE "public"."transactions_type_enum" RENAME TO "transactions_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_type_enum" AS ENUM('charge', 'refund')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions"
        ALTER COLUMN "type" TYPE "public"."transactions_type_enum"
        USING (
          CASE
            WHEN "type"::text = 'refund' THEN 'refund'
            ELSE 'charge'
          END
        )::"public"."transactions_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_type_enum_old"`);

    await queryRunner.query(
      `ALTER TYPE "public"."transactions_status_enum" RENAME TO "transactions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_status_enum" AS ENUM('success', 'failed', 'pending', 'refunded')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions"
        ALTER COLUMN "status" TYPE "public"."transactions_status_enum"
        USING (
          CASE
            WHEN "status"::text = 'processing' THEN 'pending'
            WHEN "status"::text = 'failure' THEN 'failed'
            WHEN "status"::text = 'reversed' THEN 'refunded'
            WHEN "status"::text = 'success' THEN 'success'
            ELSE 'pending'
          END
        )::"public"."transactions_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "status" SET NOT NULL`);
    await queryRunner.query(`DROP TYPE "public"."transactions_status_enum_old"`);

    await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "start_date" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TYPE "public"."subscriptions_status_enum" RENAME TO "subscriptions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions"
        ALTER COLUMN "status" TYPE "public"."subscriptions_status_enum"
        USING (
          CASE
            WHEN "status"::text = 'active' THEN 'active'
            WHEN "status"::text = 'cancelled' THEN 'cancelled'
            ELSE 'expired'
          END
        )::"public"."subscriptions_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum_old"`);
  }
}
