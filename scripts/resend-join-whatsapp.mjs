const [kind, applicationId, adminEmail] = process.argv.slice(2);

if (!['provider', 'contractor'].includes(kind) || !applicationId || !adminEmail) {
  throw new Error(
    'Usage: node scripts/resend-join-whatsapp.mjs <provider|contractor> <application-id> <admin-email>',
  );
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const greenApiUrl = process.env.GREEN_API_URL?.replace(/\/$/, '');
const greenApiId = process.env.GREEN_API_ID_INSTANCE;
const greenApiToken = process.env.GREEN_API_TOKEN_INSTANCE;

if (
  process.env.NOTIFICATIONS_ENABLED !== 'true' ||
  !supabaseUrl ||
  !supabaseKey ||
  !greenApiUrl ||
  !greenApiId ||
  !greenApiToken
) {
  throw new Error('Production notification configuration is incomplete.');
}

const restHeaders = {
  apikey: supabaseKey,
  authorization: `Bearer ${supabaseKey}`,
};

async function rest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders, ...init.headers },
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}).`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function normalizeSaudiMobile(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('05')) digits = `966${digits.slice(1)}`;
  else if (digits.startsWith('5')) digits = `966${digits}`;
  if (!/^9665\d{8}$/.test(digits)) throw new Error('Invalid Saudi admin mobile.');
  return digits;
}

function maskedMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

const profiles = await rest(
  `profiles?select=id,email,mobile&email=eq.${encodeURIComponent(adminEmail)}&limit=1`,
);
const profile = profiles?.[0];
if (!profile?.id || !profile.mobile) throw new Error('Admin profile or mobile not found.');

const adminUsers = await rest(
  `admin_users?select=profile_id&profile_id=eq.${profile.id}&is_active=eq.true&limit=1`,
);
if (!adminUsers?.length) throw new Error('The selected profile is not an active admin.');

const table = kind === 'provider' ? 'provider_applications' : 'contractor_applications';
const applications = await rest(
  `${table}?select=id,status,created_at&id=eq.${applicationId}&limit=1`,
);
const application = applications?.[0];
if (!application) throw new Error('Join application not found.');

const idempotencyKey = `join-submitted-whatsapp-${applicationId}-${profile.id}`;
const submissions = await rest(
  `notification_provider_submissions?select=attempts,status,provider_message_id&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
);
const previous = submissions?.[0];
if (previous?.status === 'submitted') {
  console.log(JSON.stringify({ status: 'already_submitted', recorded: true }));
  process.exit(0);
}

const internationalMobile = normalizeSaudiMobile(profile.mobile);
const availabilityResponse = await fetch(
  `${greenApiUrl}/waInstance${greenApiId}/checkWhatsapp/${greenApiToken}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneNumber: Number(internationalMobile), force: true }),
    signal: AbortSignal.timeout(10_000),
  },
);
const availability = await availabilityResponse.json().catch(() => ({}));
if (!availabilityResponse.ok || availability.existsWhatsapp !== true) {
  throw new Error('The configured administration number is not available on WhatsApp.');
}

const kindLabel = kind === 'provider' ? 'مزود' : 'مقاول';
const reviewPath = kind === 'provider' ? 'providers' : 'contractors';
const site = 'https://www.buniahksa.com';
const message = [
  `طلب انضمام ${kindLabel} جديد في بُنية`,
  `رقم الطلب الفريد: ${applicationId}`,
  `الحالة: ${application.status === 'pending' ? 'قيد المراجعة' : application.status}`,
  '',
  `المراجعة: ${site}/admin/join-requests/${reviewPath}`,
].join('\n');

let status = 'failed';
let providerMessageId = null;
let sanitizedError = 'provider_request_failed';
let submittedAt = null;

try {
  const response = await fetch(
    `${greenApiUrl}/waInstance${greenApiId}/sendMessage/${greenApiToken}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ chatId: `${internationalMobile}@c.us`, message }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.idMessage) {
    status = 'submitted';
    providerMessageId = payload.idMessage;
    sanitizedError = null;
    submittedAt = new Date().toISOString();
  } else {
    sanitizedError = `provider_http_${response.status}`;
  }
} catch (error) {
  sanitizedError = error?.name === 'TimeoutError' ? 'provider_timeout' : 'provider_network_error';
}

await rest('notification_provider_submissions?on_conflict=idempotency_key', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify({
    event_type: 'join.application_submitted',
    channel: 'whatsapp',
    masked_destination: maskedMobile(profile.mobile),
    idempotency_key: idempotencyKey,
    status,
    provider_message_id: providerMessageId,
    attempts: Number(previous?.attempts || 0) + 1,
    submitted_at: submittedAt,
    sanitized_error: sanitizedError,
  }),
});

console.log(JSON.stringify({ status, recorded: true, error: sanitizedError }));
if (status !== 'submitted') process.exitCode = 1;
