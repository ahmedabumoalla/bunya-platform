$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $appRoot "..\..")).Path
$values = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repoRoot ".env.local") -Encoding UTF8) {
  if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
}
$supabaseKey = $values["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
if (-not $supabaseKey) { $supabaseKey = $values["NEXT_PUBLIC_SUPABASE_ANON_KEY"] }
$appUrl = "https://www.buniahksa.com"
if (-not $values["NEXT_PUBLIC_SUPABASE_URL"] -or -not $supabaseKey) {
  throw "Supabase public configuration is missing."
}
Push-Location $appRoot
try {
  $symbols = Join-Path $appRoot "build\symbols\release-arm64"
  & flutter build apk --release --target-platform android-arm64 --split-per-abi --obfuscate "--split-debug-info=$symbols" "--dart-define=SUPABASE_URL=$($values['NEXT_PUBLIC_SUPABASE_URL'])" "--dart-define=SUPABASE_ANON_KEY=$supabaseKey" "--dart-define=APP_URL=$appUrl"
  if ($LASTEXITCODE -eq 0) {
    $apk = Join-Path $appRoot "build\app\outputs\flutter-apk\app-arm64-v8a-release.apk"
    Copy-Item -LiteralPath $apk -Destination (Join-Path $repoRoot "public\downloads\bunya-android-debug.apk") -Force
    Copy-Item -LiteralPath $apk -Destination (Join-Path $repoRoot "public\downloads\Buniah-Android-arm64-v1.0.2.apk") -Force
    Copy-Item -LiteralPath $apk -Destination (Join-Path $repoRoot "artifacts\Buniah-Android-arm64-v1.0.2.apk") -Force
  }
  exit $LASTEXITCODE
} finally { Pop-Location }
