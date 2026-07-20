# Push backend/.env cloud keys to Vercel (reads local .env — never commit secrets).
# Usage: powershell -File scripts/vercel-env-setup.ps1

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\backend\.env'
if (-not (Test-Path $envFile)) {
  Write-Error "Missing $envFile"
}

$wanted = @(
  'LLM_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODELS',
  'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_FALLBACK_MODELS',
  'GROQ_API_KEY', 'GROQ_MODEL', 'JARVIS_APP_URL', 'JARVIS_APP_NAME',
  'GITHUB_TOKEN', 'GITHUB_REPO', 'VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID',
  'BLOB_READ_WRITE_TOKEN'
)

$values = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
    $values[$Matches[1]] = $Matches[2].Trim()
  }
}

foreach ($name in $wanted) {
  if (-not $values[$name]) { continue }
  Write-Host "Setting $name on Vercel production..."
  $values[$name] | npx --yes vercel env add $name production --force
}

Write-Host 'Done. Redeploy with: npx vercel --prod'
