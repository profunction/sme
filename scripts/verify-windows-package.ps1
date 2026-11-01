param([switch]$LocalPreview)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
trap {
    $message = $_.Exception.Message.Replace('%','%25').Replace("`r",'%0D').Replace("`n",'%0A')
    Write-Host "::error title=Windows package verification::$message"
    exit 1
}
function Test-OwnedApplication([string]$executable) {
    if (-not (Test-Path $executable)) { throw "Executable missing: $executable" }
    $process = Start-Process $executable -ArgumentList '--smoke-test' -PassThru
    # Cache the native handle before exit. Start-Process can otherwise expose a null ExitCode.
    $handle = $process.Handle
    if (-not $process.WaitForExit(60000)) {
        Stop-Process -Id $process.Id
        throw "Authenticated startup timed out: $executable"
    }
    $code = $process.ExitCode
    if ($null -eq $code -or $code -ne 0) { throw "Authenticated startup failed (exit $code): $executable" }
    Write-Host 'Authenticated packaged application startup passed'
}
$probeOutput = & .venv\Scripts\python scripts/probe-frozen.py 'release\win-unpacked\resources\backend\nightbrew-backend.exe' 2>&1
$probeExitCode = $LASTEXITCODE
$probeOutput | ForEach-Object { Write-Host $_ }
if ($probeExitCode -ne 0) { throw 'Frozen backend startup failed; see sanitized diagnostic annotation' }

if ($LocalPreview) {
    $policy = Get-Content 'release\win-unpacked\resources\release-policy.json' -Raw | ConvertFrom-Json
    if (-not $policy.local_preview -or -not $policy.development_unsigned) { throw 'Expected explicit local development preview policy' }
}
Test-OwnedApplication 'release\win-unpacked\NightBrew AI Employee.exe'
$pattern = if ($LocalPreview) { 'release\NightBrew-LOCAL-PREVIEW-*.exe' } else { 'release\NightBrew-DEV-UNSIGNED-*.exe' }
$installer = Get-ChildItem $pattern | Select-Object -First 1
if (-not $installer) { throw 'No development installer produced' }
$destination = "$env:RUNNER_TEMP\NightBrewInstalled"
$installation = Start-Process $installer.FullName -ArgumentList "/S /D=$destination" -PassThru
$installationHandle = $installation.Handle
if (-not $installation.WaitForExit(300000)) { Stop-Process -Id $installation.Id; throw "Silent installation timed out" }
if ($installation.ExitCode -ne 0) { throw "Silent installation failed (exit $($installation.ExitCode))" }
if ($LocalPreview) {
    $installedPolicy = Get-Content "$destination\resources\release-policy.json" -Raw | ConvertFrom-Json
    if (-not $installedPolicy.local_preview) { throw 'Installed application is not the local preview' }
}
Write-Host 'Silent installation passed'
Test-OwnedApplication "$destination\NightBrew AI Employee.exe"
