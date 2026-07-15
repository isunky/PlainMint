[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$PackageOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
    throw "This script builds Windows packages and must run on Windows."
}

$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $AppRoot "..")).Path
$TauriRoot = Join-Path $AppRoot "src-tauri"
$TargetRoot = Join-Path $TauriRoot "target\release"
$OutputRoot = Join-Path $RepoRoot "artifacts\windows"
$PortableStage = Join-Path $OutputRoot "portable"
$Config = Get-Content (Join-Path $TauriRoot "tauri.conf.json") -Raw | ConvertFrom-Json
$Version = $Config.version
$Architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { "arm64" }
    "x86" { "x86" }
    default { "x64" }
}
$BaseName = "PlainMint_${Version}_windows_${Architecture}"
$LoadedLocalSigningKey = $false
$BuildArguments = @("run", "tauri", "--", "build", "--bundles", "msi,nsis")

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $LocalKey = Join-Path $HOME ".tauri\plainmint-updater.key"
    $LocalPassword = Join-Path $HOME ".tauri\plainmint-updater-password.dpapi"
    if ((Test-Path -LiteralPath $LocalKey) -and (Test-Path -LiteralPath $LocalPassword)) {
        $EncryptedPassword = (Get-Content -Raw -LiteralPath $LocalPassword).Trim()
        $SecurePassword = ConvertTo-SecureString $EncryptedPassword
        $Credential = [System.Management.Automation.PSCredential]::new("plainmint-updater", $SecurePassword)
        $env:TAURI_SIGNING_PRIVATE_KEY = $LocalKey
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Credential.GetNetworkCredential().Password
        $LoadedLocalSigningKey = $true
    } else {
        $BuildArguments += @("--config", "src-tauri/tauri.local.conf.json")
        Write-Host "Updater signing key not found; building installable packages without updater signatures." -ForegroundColor Yellow
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

foreach ($Command in @("node.exe", "npm.cmd", "cargo.exe")) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Command. Install Node.js 22 and Rust stable first."
    }
}

if (Test-Path -LiteralPath $OutputRoot) {
    $ResolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
    $ResolvedRepo = [System.IO.Path]::GetFullPath($RepoRoot)
    if (-not $ResolvedOutput.StartsWith($ResolvedRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean an output directory outside the repository."
    }
    Remove-Item -LiteralPath $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null

Push-Location $AppRoot
try {
    if ($PackageOnly) {
        Write-Host "[1/4] Reusing the existing release build..." -ForegroundColor DarkCyan
    } elseif (-not $SkipInstall) {
        Write-Host "[1/4] Installing dependencies..." -ForegroundColor Cyan
        Invoke-NativeCommand -Command "npm.cmd" -Arguments @("ci")
    } else {
        Write-Host "[1/4] Reusing installed dependencies..." -ForegroundColor DarkCyan
    }

    if (-not $PackageOnly) {
        Write-Host "[2/4] Building MSI and NSIS installers..." -ForegroundColor Cyan
        Invoke-NativeCommand -Command "npm.cmd" -Arguments $BuildArguments
    } else {
        Write-Host "[2/4] Existing MSI and NSIS installers selected." -ForegroundColor DarkCyan
    }

    $Application = Join-Path $TargetRoot "plainmint.exe"
    $Msi = Get-ChildItem (Join-Path $TargetRoot "bundle\msi") -Filter "*.msi" -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $Nsis = Get-ChildItem (Join-Path $TargetRoot "bundle\nsis") -Filter "*.exe" -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not (Test-Path -LiteralPath $Application) -or -not $Msi -or -not $Nsis) {
        throw "The build completed without all expected Windows artifacts."
    }

    Write-Host "[3/4] Collecting installers and portable package..." -ForegroundColor Cyan
    $MsiOutput = Join-Path $OutputRoot "${BaseName}.msi"
    $ExeOutput = Join-Path $OutputRoot "${BaseName}_setup.exe"
    Copy-Item -LiteralPath $Msi.FullName -Destination $MsiOutput
    Copy-Item -LiteralPath $Nsis.FullName -Destination $ExeOutput

    $PortableFolderName = "${BaseName}_portable"
    $PortableFolder = Join-Path $PortableStage $PortableFolderName
    New-Item -ItemType Directory -Path $PortableFolder -Force | Out-Null
    Copy-Item -LiteralPath $Application -Destination (Join-Path $PortableFolder "PlainMint.exe")
    Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $PortableFolder "LICENSE.txt")
    @"
PlainMint $Version - 绿色版 / Portable Edition

直接运行 PlainMint.exe，无需安装。
程序设置与恢复数据仍会安全地保存在当前 Windows 用户的应用数据目录中。

Run PlainMint.exe directly; no installation is required.
Settings and recovery data are still stored in the current Windows user's application-data directory.
"@ | Set-Content -LiteralPath (Join-Path $PortableFolder "README.txt") -Encoding UTF8

    $PortableOutput = Join-Path $OutputRoot "${BaseName}_portable.zip"
    Compress-Archive -LiteralPath $PortableFolder -DestinationPath $PortableOutput -CompressionLevel Optimal -Force
    Remove-Item -LiteralPath $PortableStage -Recurse -Force

    Write-Host "[4/4] Writing SHA-256 checksums..." -ForegroundColor Cyan
    $Artifacts = @($MsiOutput, $ExeOutput, $PortableOutput)
    $Checksums = foreach ($Artifact in $Artifacts) {
        $Hash = Get-FileHash -LiteralPath $Artifact -Algorithm SHA256
        "$($Hash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($Artifact))"
    }
    $Checksums | Set-Content -LiteralPath (Join-Path $OutputRoot "SHA256SUMS.txt") -Encoding ASCII

    Write-Host ""
    Write-Host "PlainMint $Version Windows packages are ready:" -ForegroundColor Green
    Get-ChildItem -LiteralPath $OutputRoot -File | ForEach-Object {
        Write-Host "  $($_.Name)" -ForegroundColor Green
    }
    Write-Host "Output: $OutputRoot" -ForegroundColor Green
}
finally {
    Pop-Location
    if ($LoadedLocalSigningKey) {
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
}
