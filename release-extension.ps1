param(
  [string]$Version = "",
  [string]$MinSupportedVersion = "",
  [string]$Repo = "hungdz2001/kido-dms-assistant-extension",
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArtifactsDir = Join-Path $ProjectRoot "artifacts"
$StageDir = Join-Path $ArtifactsDir "extension-package"
$ZipName = "dms-assistant-extension-v$Version.zip"
$ZipPath = Join-Path $ArtifactsDir $ZipName
$NodePath = "C:\Users\tranc\Downloads\node-v20.18.0-win-x64\node.exe"
$GhPath = "C:\Program Files\GitHub CLI\gh.exe"
$NpxPath = "C:\Program Files\nodejs\npx.cmd"

function Read-Utf8File([string]$Path) {
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8File([string]$Path, [string]$Content) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Replace-Required([string]$Text, [string]$Pattern, [string]$Replacement, [string]$Label) {
  if (-not [System.Text.RegularExpressions.Regex]::IsMatch($Text, $Pattern)) {
    throw "No match found for $Label"
  }
  $next = [System.Text.RegularExpressions.Regex]::Replace($Text, $Pattern, $Replacement)
  return $next
}

$ManifestPath = Join-Path $ProjectRoot "manifest.json"
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$OldVersion = [string]$Manifest.version

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $OldVersion
  $ZipName = "dms-assistant-extension-v$Version.zip"
  $ZipPath = Join-Path $ArtifactsDir $ZipName
} else {
  if ([string]::IsNullOrWhiteSpace($MinSupportedVersion)) {
    $MinSupportedVersion = $Version
  }

  $ManifestText = Read-Utf8File $ManifestPath
  $ManifestText = Replace-Required $ManifestText '"version"\s*:\s*"[^"]+"' ('"version": "' + $Version + '"') "manifest version"
  Write-Utf8File $ManifestPath $ManifestText

  $CreatorPath = Join-Path $ProjectRoot "employee-account-creator.js"
  $CreatorText = Read-Utf8File $CreatorPath
  $CreatorText = Replace-Required $CreatorText 'var EXTENSION_VERSION = "[^"]+";' ('var EXTENSION_VERSION = "' + $Version + '";') "extension version"
  Write-Utf8File $CreatorPath $CreatorText

  $WorkerPath = Join-Path $ProjectRoot "telegram-support-worker.js"
  $WorkerText = Read-Utf8File $WorkerPath
  $WorkerText = Replace-Required $WorkerText 'var WORKER_VERSION = "[^"]+";' ('var WORKER_VERSION = "' + $Version + '";') "worker version"
  $WorkerText = Replace-Required $WorkerText 'var EXTENSION_LATEST_VERSION = "[^"]+";' ('var EXTENSION_LATEST_VERSION = "' + $Version + '";') "latest extension version"
  $WorkerText = Replace-Required $WorkerText 'var EXTENSION_MIN_SUPPORTED_VERSION = "[^"]+";' ('var EXTENSION_MIN_SUPPORTED_VERSION = "' + $MinSupportedVersion + '";') "minimum supported extension version"
  Write-Utf8File $WorkerPath $WorkerText

  $TestPath = Join-Path $ProjectRoot "employee-account-creator.test.cjs"
  $TestText = Read-Utf8File $TestPath
  $TestText = $TestText.Replace($OldVersion, $Version)
  $TestText = Replace-Required $TestText 'assert\.equal\(manifest\.version, "[^"]+"\);' ('assert.equal(manifest.version, "' + $Version + '");') "test manifest version"
  $TestText = Replace-Required $TestText 'assert\.equal\(supportWorker\.WORKER_VERSION, "[^"]+"\);' ('assert.equal(supportWorker.WORKER_VERSION, "' + $Version + '");') "test worker version"
  $TestText = Replace-Required $TestText 'assert\.equal\(extensionInfo\.latest_version, "[^"]+"\);' ('assert.equal(extensionInfo.latest_version, "' + $Version + '");') "test extension info version"
  $TestText = Replace-Required $TestText 'assert\.equal\(versionJson\.latest_version, "[^"]+"\);' ('assert.equal(versionJson.latest_version, "' + $Version + '");') "test endpoint version"
  $TestText = Replace-Required $TestText 'assert\.equal\(extensionInfo\.min_supported_version, "[^"]+"\);' ('assert.equal(extensionInfo.min_supported_version, "' + $MinSupportedVersion + '");') "test extension info minimum version"
  $TestText = Replace-Required $TestText 'assert\.equal\(versionJson\.min_supported_version, "[^"]+"\);' ('assert.equal(versionJson.min_supported_version, "' + $MinSupportedVersion + '");') "test endpoint minimum version"
  Write-Utf8File $TestPath $TestText
}

if ([string]::IsNullOrWhiteSpace($MinSupportedVersion)) {
  $MinSupportedVersion = $Version
}

if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Node not found at $NodePath"
}
if (-not (Test-Path -LiteralPath $GhPath)) {
  throw "GitHub CLI not found at $GhPath"
}

Push-Location $ProjectRoot
try {
  & $NodePath "employee-account-creator.test.cjs"

  if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "icons") | Out-Null

  Copy-Item -LiteralPath (Join-Path $ProjectRoot "manifest.json") -Destination $StageDir
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "background.js") -Destination $StageDir
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "employee-account-creator.js") -Destination $StageDir
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "icons\kido-helper-16.png") -Destination (Join-Path $StageDir "icons")
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "icons\kido-helper-32.png") -Destination (Join-Path $StageDir "icons")
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "icons\kido-helper-48.png") -Destination (Join-Path $StageDir "icons")
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "icons\kido-helper-128.png") -Destination (Join-Path $StageDir "icons")

  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $ZipPath -Force

  $tag = "v$Version"
  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $GhPath release view $tag --repo $Repo *> $null
  $releaseViewCode = $LASTEXITCODE
  $ErrorActionPreference = $oldErrorActionPreference
  $releaseExists = $releaseViewCode -eq 0

  if ($releaseExists) {
    & $GhPath release upload $tag $ZipPath --repo $Repo --clobber
  } else {
    & $GhPath release create $tag $ZipPath --repo $Repo --title "DMS Assistant $Version" --notes "DMS Assistant $Version"
  }

  if (-not $SkipDeploy) {
    & $NpxPath wrangler deploy
  }

  Write-Host "Release ready: $ZipPath"
} finally {
  Pop-Location
}
