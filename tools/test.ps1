# Run the test suite in the Playwright Docker image (no local Node needed).
#   powershell -ExecutionPolicy Bypass -File tools/test.ps1                     # everything
#   powershell -ExecutionPolicy Bypass -File tools/test.ps1 tests/flight.spec.js # one file (any Playwright Test arguments)
#   $env:SEED = 7; powershell -ExecutionPolicy Bypass -File tools/test.ps1       # another random seed
# node_modules lives in a Docker volume, so Linux binaries never land in the checkout.
$ErrorActionPreference = 'Stop'
$image = 'mcr.microsoft.com/playwright:v1.63.0-noble'   # keep in sync with @playwright/test in package.json
$root = Split-Path -Parent $PSScriptRoot
$seed = if ($env:SEED) { $env:SEED } else { '1' }
$quoted = $args | ForEach-Object { "'" + ($_ -replace "'", "'''") + "'" }   # passed to bash as single-quoted words
$cmd = 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test ' + ($quoted -join ' ')
docker run --rm --ipc=host -e SEED=$seed -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "${root}:/work" -v code3-node-modules:/work/node_modules -w /work $image bash -c $cmd
exit $LASTEXITCODE
