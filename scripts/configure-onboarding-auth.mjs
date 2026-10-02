// Apply migration089 first. Run with server-side SUPABASE_ACCESS_TOKEN and
// NEXT_PUBLIC_SUPABASE_URL; --apply enables the hook after checking compatibility.
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Management credential is required');
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const hook = 'pg-functions://postgres/public/onboarding_access_token_hook';
async function request(method = 'GET', body) {
  const response = await fetch(endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`Auth configuration failed (HTTP ${response.status}); credentials withheld`);
  return response.json();
}
let config = await request();
if (Number(config.password_min_length) > 8 || config.password_required_characters) throw new Error('Project password policy does not permit eight numeric digits');
if (config.hook_custom_access_token_enabled && config.hook_custom_access_token_uri !== hook) throw new Error('An existing Auth hook must be integrated before changing configuration');
if (process.argv.includes('--apply')) {
  await request('PATCH', { hook_custom_access_token_enabled: true, hook_custom_access_token_uri: hook });
  config = await request();
  if (!config.hook_custom_access_token_enabled || config.hook_custom_access_token_uri !== hook) throw new Error('Auth hook configuration was not retained');
}
console.log(JSON.stringify({ applied: process.argv.includes('--apply'), onboardingExpiryHookEnabled: Boolean(config.hook_custom_access_token_enabled && config.hook_custom_access_token_uri === hook), eightNumericDigitsAllowed: true }));
