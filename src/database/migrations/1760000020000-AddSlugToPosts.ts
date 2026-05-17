import { MigrationInterface, QueryRunner } from 'typeorm';

const MAX_SLUG_LENGTH = 80;

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'j', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '',
  ю: 'yu', я: 'ya', ё: 'yo', э: 'e', ъ: '', ы: 'y',
};

function buildSlug(postId: number, title: string | null): string {
  if (!title?.trim()) return String(postId);

  const slug = title
    .toLowerCase()
    .trim()
    .split('')
    .map((char) => (char in CYRILLIC_MAP ? CYRILLIC_MAP[char] : char))
    .join('')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  return slug ? `${postId}-${slug}` : String(postId);
}

export class AddSlugToPosts1760000020000 implements MigrationInterface {
  name = 'AddSlugToPosts1760000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" ADD COLUMN "slug" VARCHAR(300)`);

    const posts: Array<{ post_id: number; title: string | null }> = await queryRunner.query(
      `SELECT post_id, title FROM "posts"`,
    );

    for (const post of posts) {
      const slug = buildSlug(post.post_id, post.title);
      await queryRunner.query(
        `UPDATE "posts" SET "slug" = $1 WHERE post_id = $2`,
        [slug, post.post_id],
      );
    }

    await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "slug" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_posts_slug" ON "posts" ("slug")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_slug"`);
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "slug"`);
  }
}
