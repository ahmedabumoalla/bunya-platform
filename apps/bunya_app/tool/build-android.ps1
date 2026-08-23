$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $appRoot "..\..")).Path
$values = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repoRoot ".env.local") -Encoding UTF8) {
  if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
}
$supabaseKey = $values["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
if (-not $supabaseKey) { $supabaseKey = $values["NEXT_PUBLIC_SUPABASE_ANON_KEY"] }
$appUrl = "https://www.buniahksa.com"
Push-Location $appRoot
try {
  & flutter build apk --release --split-per-abi "--dart-define=SUPABASE_URL=$($values['NEXT_PUBLIC_SUPABASE_URL'])" "--dart-define=SUPABASE_ANON_KEY=$supabaseKey" "--dart-define=APP_URL=$appUrl"
  if ($LASTEXITCODE -eq 0) {
    Copy-Item -LiteralPath (Join-Path $appRoot "build\app\outputs\flutter-apk\app-arm64-v8a-release.apk") -Destination (Join-Path $repoRoot "public\downloads\bunya-android-debug.apk") -Force
  }
  exit $LASTEXITCODE
} finally { Pop-Location }
