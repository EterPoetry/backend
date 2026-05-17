const MAX_SLUG_LENGTH = 80;

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'j', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '',
  ю: 'yu', я: 'ya',
  // Russian extras
  ё: 'yo', э: 'e', ъ: '', ы: 'y',
};

function transliterate(text: string): string {
  return text
    .split('')
    .map((char) => {
      const lower = char.toLowerCase();
      if (lower in CYRILLIC_MAP) {
        return CYRILLIC_MAP[lower];
      }
      return char;
    })
    .join('');
}

export function buildPostSlug(postId: number, title: string | null): string {
  if (!title?.trim()) {
    return String(postId);
  }

  const slug = transliterate(title.toLowerCase().trim())
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  return slug ? `${postId}-${slug}` : String(postId);
}

export function extractPostIdFromSlug(slug: string): number | null {
  const match = /^(\d+)/.exec(slug);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}
