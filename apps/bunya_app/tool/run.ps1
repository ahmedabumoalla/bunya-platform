param(
  [ValidateSet("web", "android")]
  [string]$Target = "web",
  [int]$Port = 8090
)

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
  $defines = @("--dart-define=SUPABASE_URL=$supabaseUrl", "--dart-define=SUPABASE_ANON_KEY=$supabaseKey")
  if ($Target -eq "web") {
    & flutter run -d web-server --web-hostname 127.0.0.1 --web-port $Port @defines
  } else {
    & flutter run @defines
  }
  exit $LASTEXITCODE
} finally { Pop-Location }
