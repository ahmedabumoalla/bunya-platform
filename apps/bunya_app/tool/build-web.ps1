$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $appRoot "..\..")).Path
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
  & flutter build web --release "--dart-define=SUPABASE_URL=$supabaseUrl" "--dart-define=SUPABASE_ANON_KEY=$supabaseKey" "--dart-define=APP_URL=https://www.buniahksa.com"
  exit $LASTEXITCODE
} finally { Pop-Location }
