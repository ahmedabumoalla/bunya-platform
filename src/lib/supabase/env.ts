const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseLegacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export function getSupabasePublicEnv() {
  const key = supabasePublishableKey || supabaseLegacyAnonKey;

  if (!supabaseUrl || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }

  return { url: supabaseUrl, key };
}

export function getSiteUrl() {
  if (!siteUrl) {
    throw new Error("Supabase auth redirects require NEXT_PUBLIC_SITE_URL.");
  }

  return siteUrl.replace(/\/$/, "");
}
