param(
  [string]$CommitMsgFile = $args[0]
)

if (-not $CommitMsgFile -or -not (Test-Path $CommitMsgFile)) {
  exit 0
}

$lines = Get-Content -Path $CommitMsgFile | Where-Object {
  $_ -notmatch 'Co-authored-by:\s*Cursor\s*<cursoragent@cursor\.com>'
}
if ($lines.Count -eq 0) {
  $lines = @('')
}
Set-Content -Path $CommitMsgFile -Value $lines -Encoding utf8
