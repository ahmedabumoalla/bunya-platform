$ErrorActionPreference = "Stop"

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $appRoot "..\..")).Path
$signingFile = Join-Path $appRoot "android\key.properties"
if (-not (Test-Path -LiteralPath $signingFile -PathType Leaf)) {
  throw "Missing private Android upload signing configuration. See docs/ANDROID_RELEASE_SIGNING.md in the repository root."
}
$envFile = Join-Path $repoRoot ".env.local"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing .env.local in repository root." }

$values = @{}
foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
  if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
}
$supabaseUrl = $values["NEXT_PUBLIC_SUPABASE_URL"]
$supabaseKey = $values["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
if (-not $supabaseKey) { $supabaseKey = $values["NEXT_PUBLIC_SUPABASE_ANON_KEY"] }
if (-not $supabaseUrl -or -not $supabaseKey) { throw "Supabase public configuration is missing." }

Push-Location $appRoot
try {
  $symbols = Join-Path $appRoot "build\symbols\release-aab"
  & flutter build appbundle --release --obfuscate "--split-debug-info=$symbols" "--dart-define=SUPABASE_URL=$supabaseUrl" "--dart-define=SUPABASE_ANON_KEY=$supabaseKey" "--dart-define=APP_URL=https://www.buniahksa.com"
  exit $LASTEXITCODE
} finally { Pop-Location }
