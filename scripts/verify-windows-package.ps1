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

Test-OwnedApplication 'release\win-unpacked\NightBrew AI Employee.exe'
$installer = Get-ChildItem release\NightBrew-DEV-UNSIGNED-*.exe | Select-Object -First 1
if (-not $installer) { throw 'No development installer produced' }
$destination = "$env:RUNNER_TEMP\NightBrewInstalled"
$installation = Start-Process $installer.FullName -ArgumentList "/S /D=$destination" -Wait -PassThru
if ($installation.ExitCode -ne 0) { throw "Silent installation failed (exit $($installation.ExitCode))" }
Write-Host 'Silent installation passed'
Test-OwnedApplication "$destination\NightBrew AI Employee.exe"
