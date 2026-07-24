# Install git hook that strips Cursor co-author trailers from commit messages.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$HookDir = Join-Path $Root ".git\hooks"
$Hook = Join-Path $HookDir "prepare-commit-msg"
$Source = Join-Path $Root "scripts\prepare-commit-msg"
New-Item -ItemType Directory -Force -Path $HookDir | Out-Null
Copy-Item -Force $Source $Hook
Write-Host "Installed prepare-commit-msg hook at $Hook"
