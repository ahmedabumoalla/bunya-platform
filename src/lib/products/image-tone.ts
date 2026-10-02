// Image placeholders use a fixed palette; catalog categories are administrator-managed.
export const PRODUCT_IMAGE_TONES = new Set([
  "cement", "steel", "blocks", "insulation", "plumbing", "electric", "wood", "paint", "tools",
]);

export function productImageTone(categorySlug: string | null | undefined): string {
  const aliases: Record<string, string> = {
    "blocks-bricks": "blocks",
    electrical: "electric",
    "tools-equipment": "tools",
  };
  const slug = categorySlug ?? "";
  const tone = Object.hasOwn(aliases, slug) ? aliases[slug] : slug;
  return PRODUCT_IMAGE_TONES.has(tone) ? tone : "tools";
}
