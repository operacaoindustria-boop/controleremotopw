param(
    [switch]$Install,
    [switch]$Uninstall
)

$taskName = 'Controle Remoto TCL'
$scriptPath = $PSCommandPath
$projectPath = $PSScriptRoot
$logDirectory = Join-Path $env:LOCALAPPDATA 'TCLRemote'
$savedSleepTimeoutPath = Join-Path $logDirectory 'previous-ac-sleep-timeout.txt'

if ($Install -and $Uninstall) {
    throw 'Use -Install or -Uninstall, not both.'
}

if ($Install) {
    New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
    if (-not (Test-Path $savedSleepTimeoutPath)) {
        $powerQuery = (& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) {
            throw "Could not read the current sleep timeout: $powerQuery"
        }
        $settings = [regex]::Matches($powerQuery, '(?im)^\s*.*?:\s*0x([0-9a-f]{8})\s*$')
        if ($settings.Count -lt 5) {
            throw 'Could not identify the AC sleep timeout; no power setting was changed.'
        }
        $previousSeconds = [Convert]::ToInt64($settings[3].Groups[1].Value, 16)
        if (($previousSeconds % 60) -ne 0) {
            throw 'The current sleep timeout is not in whole minutes; no power setting was changed.'
        }
        Set-Content -Path $savedSleepTimeoutPath -Value ([string]($previousSeconds / 60)) -NoNewline
    }

    & powercfg.exe /change standby-timeout-ac 0
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not disable sleep while the PC is plugged in.'
    }

    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $powerShellPath = Join-Path $PSHOME 'powershell.exe'
    $actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
    $action = New-ScheduledTaskAction `
        -Execute $powerShellPath `
        -Argument $actionArguments `
        -WorkingDirectory $projectPath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal `
        -UserId $currentUser `
        -LogonType Interactive `
        -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description 'Keeps the TCL remote-control backend running during the Windows session.' `
        -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName

    Write-Output "Background startup configured for $currentUser."
    Write-Output 'The server will start when this account signs in to Windows.'
    Write-Output 'Sleep is disabled only while the PC is plugged in.'
    Write-Output 'Run this script with -Uninstall to remove the automatic startup.'
    exit 0
}

if ($Uninstall) {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Output 'Automatic startup removed.'
    } else {
        Write-Output 'Automatic startup was already removed.'
    }

    if (Test-Path $savedSleepTimeoutPath) {
        $previousMinutes = (Get-Content $savedSleepTimeoutPath -Raw).Trim()
        if ($previousMinutes -notmatch '^\d+$') {
            throw "Saved sleep timeout is invalid: $savedSleepTimeoutPath"
        }
        & powercfg.exe /change standby-timeout-ac $previousMinutes
        if ($LASTEXITCODE -ne 0) {
            throw 'Automatic startup was removed, but the previous sleep timeout could not be restored.'
        }
        Remove-Item -LiteralPath $savedSleepTimeoutPath
        Write-Output 'Previous plugged-in sleep timeout restored.'
    }
    exit 0
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
$env:REMOTE_UI_ORIGINS = 'https://operacaoindustria-boop.github.io'
Remove-Item Env:\TV_IP -ErrorAction SilentlyContinue

while ($true) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outputLog = Join-Path $logDirectory "server-$timestamp.log"
    $errorLog = Join-Path $logDirectory "server-$timestamp-error.log"

    try {
        $process = Start-Process `
            -FilePath $nodePath `
            -ArgumentList 'server.js' `
            -WorkingDirectory $projectPath `
            -PassThru `
            -Wait `
            -WindowStyle Hidden `
            -RedirectStandardOutput $outputLog `
            -RedirectStandardError $errorLog
        Add-Content -Path $outputLog -Value "Servidor encerrado com código $($process.ExitCode). Reiniciando em 5 segundos."
    } catch {
        Add-Content -Path $errorLog -Value "$(Get-Date -Format o) Falha ao iniciar o servidor: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 5
}
