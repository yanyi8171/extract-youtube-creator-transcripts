[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillRoot = Split-Path -Parent $ScriptRoot
$Lock = Get-Content -LiteralPath (Join-Path $SkillRoot 'toolchain.lock.json') -Raw | ConvertFrom-Json
$AppRoot = Join-Path $env:LOCALAPPDATA 'YouTubeCreatorTranscripts'
$RuntimeRoot = Join-Path $AppRoot 'runtime'
$env:DENO_DIR = Join-Path $RuntimeRoot 'deno-cache'
$Downloads = Join-Path $AppRoot 'downloads'

$Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$AssetKey = if ($Architecture -eq 'arm64') { 'windows-arm64' } else { 'windows-x64' }
$DenoAsset = $Lock.deno.assets.$AssetKey
$YtAsset = $Lock.yt_dlp.assets.$AssetKey
$DenoRoot = Join-Path $RuntimeRoot ("deno-{0}" -f $Lock.deno.version)
$DenoExe = Join-Path $DenoRoot 'deno.exe'
$YtRoot = Join-Path $RuntimeRoot ("yt-dlp-{0}" -f $Lock.yt_dlp.version)
$YtExe = Join-Path $YtRoot 'yt-dlp.exe'
$PotRoot = Join-Path $RuntimeRoot ("pot-provider-{0}" -f $Lock.pot_provider.version)
$PotPlugin = Join-Path $PotRoot 'plugin'
$PotMarker = Join-Path $PotRoot '.installed.json'

function Test-Ready {
    param([string]$Path)
    return Test-Path -LiteralPath $Path -PathType Leaf
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-VerifiedDownload {
    param(
        [string]$Url,
        [string]$ExpectedSha256,
        [string]$Name
    )
    New-Item -ItemType Directory -Path $Downloads -Force | Out-Null
    $Target = Join-Path $Downloads ("{0}-{1}" -f [guid]::NewGuid().ToString('N'), $Name)
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Target -Headers @{ 'User-Agent' = 'YouTubeCreatorTranscripts/1.0' }
        $Actual = Get-Sha256 -Path $Target
        if ($Actual -ne $ExpectedSha256.ToLowerInvariant()) {
            throw "SHA-256 verification failed for $Name (expected $ExpectedSha256, got $Actual)"
        }
        return $Target
    } catch {
        if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }
        throw
    }
}

function Install-CoreTools {
    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    if (-not (Test-Ready $DenoExe)) {
        $Archive = Get-VerifiedDownload -Url $DenoAsset.url -ExpectedSha256 $DenoAsset.sha256 -Name 'deno.zip'
        $Stage = Join-Path $RuntimeRoot (".deno-stage-{0}" -f [guid]::NewGuid().ToString('N'))
        try {
            New-Item -ItemType Directory -Path $Stage | Out-Null
            Expand-Archive -LiteralPath $Archive -DestinationPath $Stage -Force
            New-Item -ItemType Directory -Path $DenoRoot -Force | Out-Null
            Move-Item -LiteralPath (Join-Path $Stage 'deno.exe') -Destination $DenoExe -Force
        } finally {
            if (Test-Path -LiteralPath $Archive) { Remove-Item -LiteralPath $Archive -Force }
            if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
        }
    }
    if (-not (Test-Ready $YtExe)) {
        $Download = Get-VerifiedDownload -Url $YtAsset.url -ExpectedSha256 $YtAsset.sha256 -Name 'yt-dlp.exe'
        New-Item -ItemType Directory -Path $YtRoot -Force | Out-Null
        Move-Item -LiteralPath $Download -Destination $YtExe -Force
    }
    & $DenoExe --version | Select-Object -First 1
    & $YtExe --version
}

function Install-PotProvider {
    if (-not (Test-Ready $DenoExe)) { throw 'Run --install before installing the PO Token Provider.' }
    if (Test-Ready $PotMarker) { Write-Output "PO Token Provider is already installed: $PotRoot"; return }
    $RuntimeFull = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\') + '\'
    $PotFull = [IO.Path]::GetFullPath($PotRoot)
    if (-not $PotFull.StartsWith($RuntimeFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe Provider target: $PotFull" }
    if (Test-Path -LiteralPath $PotRoot) { Remove-Item -LiteralPath $PotRoot -Recurse -Force }

    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    $PluginZip = Get-VerifiedDownload -Url $Lock.pot_provider.plugin.url -ExpectedSha256 $Lock.pot_provider.plugin.sha256 -Name 'pot-plugin.zip'
    $SourceZip = Get-VerifiedDownload -Url $Lock.pot_provider.source.url -ExpectedSha256 $Lock.pot_provider.source.sha256 -Name 'pot-source.zip'
    $Stage = Join-Path $RuntimeRoot (".pot-stage-{0}" -f [guid]::NewGuid().ToString('N'))
    try {
        $SourceStage = Join-Path $Stage 'source'
        $PluginStage = Join-Path $Stage 'plugin'
        New-Item -ItemType Directory -Path $SourceStage,$PluginStage -Force | Out-Null
        Expand-Archive -LiteralPath $SourceZip -DestinationPath $SourceStage -Force
        Expand-Archive -LiteralPath $PluginZip -DestinationPath $PluginStage -Force
        $Inner = Get-ChildItem -LiteralPath $SourceStage -Directory | Select-Object -First 1
        if (-not $Inner) { throw 'Unexpected PO Token Provider source archive layout.' }
        $Ready = Join-Path $Stage 'ready'
        New-Item -ItemType Directory -Path $Ready | Out-Null
        Get-ChildItem -LiteralPath $Inner.FullName -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $Ready }
        Move-Item -LiteralPath $PluginStage -Destination (Join-Path $Ready 'plugin')
        if (Test-Path -LiteralPath $PotRoot) { throw "Provider target exists but is incomplete: $PotRoot" }
        Move-Item -LiteralPath $Ready -Destination $PotRoot
        Push-Location (Join-Path $PotRoot 'server')
        try {
            & $DenoExe install --allow-scripts=npm:canvas --frozen
            if ($LASTEXITCODE -ne 0) { throw "Deno failed to install Provider dependencies (exit $LASTEXITCODE)." }
        } finally {
            Pop-Location
        }
        @{ version = $Lock.pot_provider.version; installed_at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $PotMarker -Encoding UTF8
    } finally {
        foreach ($Path in @($PluginZip,$SourceZip)) { if ($Path -and (Test-Path -LiteralPath $Path)) { Remove-Item -LiteralPath $Path -Force } }
        if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
        if ((Test-Path -LiteralPath $PotRoot) -and -not (Test-Ready $PotMarker)) { Remove-Item -LiteralPath $PotRoot -Recurse -Force }
    }
    Write-Output "PO Token Provider installed: $PotRoot"
}

function Show-Preflight {
    $Items = @()
    if (-not (Test-Ready $DenoExe)) { $Items += [ordered]@{ name = 'Deno'; version = $Lock.deno.version; bytes = [int64]$DenoAsset.size } }
    if (-not (Test-Ready $YtExe)) { $Items += [ordered]@{ name = 'yt-dlp'; version = $Lock.yt_dlp.version; bytes = [int64]$YtAsset.size } }
    [ordered]@{
        ready = ($Items.Count -eq 0)
        install_required = $Items
        install_location = $RuntimeRoot
        modifies_path = $false
        needs_admin = $false
        pot_provider_installed = (Test-Ready $PotMarker)
    } | ConvertTo-Json -Depth 5
}

$Mode = 'run'
if ($RemainingArgs.Count -gt 0 -and $RemainingArgs[0] -in @('--preflight','--install','--install-pot')) {
    $Mode = $RemainingArgs[0].Substring(2)
    $RemainingArgs = @($RemainingArgs | Select-Object -Skip 1)
}

try {
    switch ($Mode) {
        'preflight' { Show-Preflight; exit 0 }
        'install' { Install-CoreTools; if ($RemainingArgs.Count -eq 0) { Show-Preflight; exit 0 } }
        'install-pot' { Install-PotProvider; if ($RemainingArgs.Count -eq 0) { exit 0 } }
    }
    if (-not (Test-Ready $DenoExe) -or -not (Test-Ready $YtExe)) {
        Show-Preflight
        Write-Error 'Private tools are missing. Run --install after user confirmation.'
        exit 20
    }
    $Main = Join-Path $ScriptRoot 'main.ts'
    $Internal = @('--yt-dlp', $YtExe)
    if (Test-Ready $PotMarker) { $Internal += @('--pot-home', $PotRoot, '--pot-plugin', $PotPlugin) }
    & $DenoExe run --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-sys --allow-net=127.0.0.1,localhost $Main @Internal @RemainingArgs
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 30
}
