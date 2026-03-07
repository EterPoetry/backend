import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1741377600000 implements MigrationInterface {
  name = 'InitSchema1741377600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."post_reactions_reaction_type_enum" AS ENUM('touched', 'strong', 'quiet')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."post_complaints_status_enum" AS ENUM('pending', 'resolved', 'dismissed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_status_enum" AS ENUM('success', 'failed', 'pending', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_type_enum" AS ENUM('charge', 'refund')`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "user_id" SERIAL NOT NULL,
        "name" character varying(120) NOT NULL,
        "email" character varying(320) NOT NULL,
        "password" character varying(255) NOT NULL,
        "photo" character varying(500),
        "is_email_verified" boolean NOT NULL DEFAULT false,
        "verification_code" character varying(32),
        "verification_code_sent_date" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_user_id" PRIMARY KEY ("user_id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "admins" (
        "admin_id" SERIAL NOT NULL,
        "name" character varying(120) NOT NULL,
        "email" character varying(320) NOT NULL,
        "password" character varying(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_global_admin" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_admins_admin_id" PRIMARY KEY ("admin_id"),
        CONSTRAINT "UQ_admins_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "posts" (
        "post_id" SERIAL NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" text,
        "text" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "audio_file_name" character varying(300) NOT NULL,
        "listens" integer NOT NULL DEFAULT 0,
        "origin_author_name" character varying(200),
        "author_id" integer NOT NULL,
        CONSTRAINT "PK_posts_post_id" PRIMARY KEY ("post_id"),
        CONSTRAINT "FK_posts_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "post_text_parts" (
        "post_text_part_id" SERIAL NOT NULL,
        "line_index" integer NOT NULL,
        "audio_start_moment_ms" integer NOT NULL,
        "post_id" integer NOT NULL,
        CONSTRAINT "PK_post_text_parts_post_text_part_id" PRIMARY KEY ("post_text_part_id"),
        CONSTRAINT "UQ_post_text_parts_post_line" UNIQUE ("post_id", "line_index"),
        CONSTRAINT "FK_post_text_parts_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "categories" (
        "category_id" SERIAL NOT NULL,
        "category_name" character varying(120) NOT NULL,
        "category_description" text,
        CONSTRAINT "PK_categories_category_id" PRIMARY KEY ("category_id"),
        CONSTRAINT "UQ_categories_category_name" UNIQUE ("category_name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "post_categories" (
        "post_category_id" SERIAL NOT NULL,
        "post_id" integer NOT NULL,
        "category_id" integer NOT NULL,
        CONSTRAINT "PK_post_categories_post_category_id" PRIMARY KEY ("post_category_id"),
        CONSTRAINT "UQ_post_categories_post_category" UNIQUE ("post_id", "category_id"),
        CONSTRAINT "FK_post_categories_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_categories_category_id" FOREIGN KEY ("category_id") REFERENCES "categories"("category_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "post_reactions" (
        "post_reaction_id" SERIAL NOT NULL,
        "post_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "reaction_type" "public"."post_reactions_reaction_type_enum" NOT NULL,
        CONSTRAINT "PK_post_reactions_post_reaction_id" PRIMARY KEY ("post_reaction_id"),
        CONSTRAINT "UQ_post_reactions_post_user" UNIQUE ("post_id", "user_id"),
        CONSTRAINT "FK_post_reactions_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_reactions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "post_comments" (
        "post_comment_id" SERIAL NOT NULL,
        "comment_text" text NOT NULL,
        "post_id" integer NOT NULL,
        "comment_author_id" integer NOT NULL,
        "reply_to_comment_id" integer,
        CONSTRAINT "PK_post_comments_post_comment_id" PRIMARY KEY ("post_comment_id"),
        CONSTRAINT "FK_post_comments_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_comments_comment_author_id" FOREIGN KEY ("comment_author_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_comments_reply_to_comment_id" FOREIGN KEY ("reply_to_comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "comment_reactions" (
        "comment_reaction_id" SERIAL NOT NULL,
        "post_comment_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        CONSTRAINT "PK_comment_reactions_comment_reaction_id" PRIMARY KEY ("comment_reaction_id"),
        CONSTRAINT "UQ_comment_reactions_comment_user" UNIQUE ("post_comment_id", "user_id"),
        CONSTRAINT "FK_comment_reactions_post_comment_id" FOREIGN KEY ("post_comment_id") REFERENCES "post_comments"("post_comment_id") ON DELETE CASCADE,
        CONSTRAINT "FK_comment_reactions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "post_complaints" (
        "post_complaint_id" SERIAL NOT NULL,
        "complaint_reason" text NOT NULL,
        "status" "public"."post_complaints_status_enum" NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMPTZ,
        "author_id" integer NOT NULL,
        "target_user_id" integer NOT NULL,
        "target_post_id" integer NOT NULL,
        "admin_id" integer,
        CONSTRAINT "PK_post_complaints_post_complaint_id" PRIMARY KEY ("post_complaint_id"),
        CONSTRAINT "FK_post_complaints_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_complaints_target_user_id" FOREIGN KEY ("target_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_complaints_target_post_id" FOREIGN KEY ("target_post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE,
        CONSTRAINT "FK_post_complaints_admin_id" FOREIGN KEY ("admin_id") REFERENCES "admins"("admin_id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "followers" (
        "follower_id" SERIAL NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "follower_user_id" integer NOT NULL,
        "target_user_id" integer NOT NULL,
        CONSTRAINT "PK_followers_follower_id" PRIMARY KEY ("follower_id"),
        CONSTRAINT "UQ_followers_follower_target" UNIQUE ("follower_user_id", "target_user_id"),
        CONSTRAINT "FK_followers_follower_user_id" FOREIGN KEY ("follower_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
        CONSTRAINT "FK_followers_target_user_id" FOREIGN KEY ("target_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "notification_id" SERIAL NOT NULL,
        "notification_text" text NOT NULL,
        "notification_type" character varying(100) NOT NULL,
        "is_read" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "user_id" integer NOT NULL,
        "post_id" integer NOT NULL,
        CONSTRAINT "PK_notifications_notification_id" PRIMARY KEY ("notification_id"),
        CONSTRAINT "FK_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_post_id" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "subscription_id" SERIAL NOT NULL,
        "status" "public"."subscriptions_status_enum" NOT NULL,
        "next_payment_date" date,
        "start_date" date NOT NULL,
        "wallet_id" character varying(100),
        "cancellation_date" date,
        "user_id" integer NOT NULL,
        CONSTRAINT "PK_subscriptions_subscription_id" PRIMARY KEY ("subscription_id"),
        CONSTRAINT "UQ_subscriptions_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_subscriptions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "transaction_id" SERIAL NOT NULL,
        "invoice_id" character varying(120) NOT NULL,
        "status" "public"."transactions_status_enum" NOT NULL,
        "type" "public"."transactions_type_enum" NOT NULL,
        "sum" numeric(10,2) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "currency" character varying(10) NOT NULL,
        "subscription_id" integer NOT NULL,
        CONSTRAINT "PK_transactions_transaction_id" PRIMARY KEY ("transaction_id"),
        CONSTRAINT "UQ_transactions_invoice_id" UNIQUE ("invoice_id"),
        CONSTRAINT "FK_transactions_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("subscription_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "cards" (
        "card_id" SERIAL NOT NULL,
        "token" character varying(255) NOT NULL,
        "payment_system" character varying(30) NOT NULL,
        "masked_number" character varying(30) NOT NULL,
        "subscription_id" integer NOT NULL,
        CONSTRAINT "PK_cards_card_id" PRIMARY KEY ("card_id"),
        CONSTRAINT "UQ_cards_token" UNIQUE ("token"),
        CONSTRAINT "UQ_cards_subscription_id" UNIQUE ("subscription_id"),
        CONSTRAINT "FK_cards_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("subscription_id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cards"`);
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "followers"`);
    await queryRunner.query(`DROP TABLE "post_complaints"`);
    await queryRunner.query(`DROP TABLE "comment_reactions"`);
    await queryRunner.query(`DROP TABLE "post_comments"`);
    await queryRunner.query(`DROP TABLE "post_reactions"`);
    await queryRunner.query(`DROP TABLE "post_categories"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TABLE "post_text_parts"`);
    await queryRunner.query(`DROP TABLE "posts"`);
    await queryRunner.query(`DROP TABLE "admins"`);
    await queryRunner.query(`DROP TABLE "users"`);

    await queryRunner.query(`DROP TYPE "public"."transactions_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."transactions_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."post_complaints_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."post_reactions_reaction_type_enum"`);
  }
}
