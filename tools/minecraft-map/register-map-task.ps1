<#
.SYNOPSIS
  Registers Windows scheduled tasks that publish the Minecraft map automatically.

.DESCRIPTION
  "Minecraft map" runs publish-map.ps1 every day at -At (default 8 PM). Optionally,
  "Minecraft map players" runs it with -PlayersOnly every -PlayersEveryMinutes minutes.
  Each run's output goes to <LogDir>\publish.log (or publish-players.log), overwritten each time.

  The tasks run as you, while you're logged in, so they use your `firebase login`, Java and Node.
  Re-running replaces the tasks.

.EXAMPLE
  .\register-map-task.ps1
.EXAMPLE
  .\register-map-task.ps1 -At 20:00 -PlayersEveryMinutes 15
#>
[CmdletBinding()]
param(
  # Time of day for the full map publish.
  [string]$At = '20:00',

  # Also refresh players' last-seen positions this often (minutes); 0 = don't.
  [int]$PlayersEveryMinutes = 0,

  [string]$LogDir = 'C:\minecraft-map'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$publishScript = Join-Path $ScriptDir 'publish-map.ps1'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function New-PublishAction([string]$ExtraArgs, [string]$LogFile) {
  # *> sends every output stream (including the tools' console output) to the log.
  $command = "& '$publishScript' -AcceptMinecraftEula $ExtraArgs *> '$LogFile'"
  New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$command`"" `
    -WorkingDirectory $ScriptDir
}

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
# Renders can take a while; don't let Windows stop them early, and run a missed time on next boot.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12)

Register-ScheduledTask -TaskName 'Minecraft map' -Force `
  -Description 'Renders the Minecraft world with BlueMap and publishes it to palepail.com.' `
  -Action (New-PublishAction '' (Join-Path $LogDir 'publish.log')) `
  -Trigger (New-ScheduledTaskTrigger -Daily -At $At) `
  -Settings $settings -Principal $principal | Out-Null
Write-Host "Registered 'Minecraft map': every day at $At (log: $(Join-Path $LogDir 'publish.log'))"

if ($PlayersEveryMinutes -gt 0) {
  # Repeats all day, every day. A -Once trigger with no -RepetitionDuration gets an "indefinite"
  # duration that some Windows versions store as a value Get-ScheduledTask can't read back, which
  # breaks Get-ScheduledTask for every task.
  $trigger = New-ScheduledTaskTrigger -Daily -At 00:00
  $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At 00:00 `
      -RepetitionInterval (New-TimeSpan -Minutes $PlayersEveryMinutes) `
      -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
  Register-ScheduledTask -TaskName 'Minecraft map players' -Force `
    -Description 'Refreshes player last-seen positions on the palepail.com Minecraft map.' `
    -Action (New-PublishAction '-PlayersOnly' (Join-Path $LogDir 'publish-players.log')) `
    -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
  Write-Host "Registered 'Minecraft map players': every $PlayersEveryMinutes minutes"
}

Write-Host "Test it now with: Start-ScheduledTask -TaskName 'Minecraft map'"
