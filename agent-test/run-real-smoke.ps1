[CmdletBinding()]
param(
  [ValidateRange(60, 3600)]
  [int]$TimeoutSeconds = 900,
  [switch]$SingleProcessTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
  param(
    [Parameter(Mandatory)]
    [string]$Program,
    [Parameter(Mandatory)]
    [string[]]$Arguments
  )

  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program exited with code $LASTEXITCODE"
  }
}

function Read-DeepSeekApiKey {
  param([Parameter(Mandatory)][string]$Path)

  $line = Get-Content -LiteralPath $Path -Encoding UTF8 |
    Where-Object { $_ -match '^\s*(?:DEEPSEEK_)?API_KEY\s*=' } |
    Select-Object -First 1
  if ($null -eq $line) {
    throw "No API_KEY or DEEPSEEK_API_KEY entry exists in $Path"
  }

  $value = ($line -split '=', 2)[1].Trim()
  $value = $value -replace '^[\s"''“”‘’]+|[\s"''“”‘’]+$', ''
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "The API key entry in $Path is blank"
  }
  return $value
}

$harnessRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runRoot = Join-Path $PSScriptRoot ('.run\real-' + [guid]::NewGuid().ToString('N'))
$repository = Join-Path $runRoot 'repository'
$dshHome = Join-Path $runRoot 'home'
$sessions = Join-Path $runRoot 'sessions'
$agentsHome = Join-Path $runRoot 'agents'
$profile = Join-Path $dshHome 'profiles\crew-native'
$transcript = Join-Path $runRoot 'transcript.txt'
$builtCli = Join-Path $harnessRoot 'apps\cli\lib\bin.js'

if (-not (Test-Path -LiteralPath $builtCli -PathType Leaf)) {
  throw 'The built dsh CLI is missing. Run pnpm run build before this smoke.'
}

Write-Output "CREW_REAL_API_RUN=$runRoot"
New-Item -ItemType Directory -Path $repository, $profile, $sessions, $agentsHome -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'template\*') -Destination $repository -Recurse -Force
Copy-Item -Path (Join-Path $PSScriptRoot 'profile\*') -Destination $profile -Recurse -Force
$profileModules = Join-Path $profile 'node_modules\@deepseek-ai'
New-Item -ItemType Directory -Path $profileModules | Out-Null
New-Item -ItemType Junction -Path (Join-Path $profileModules 'dsh-experimental-crew-profile') -Target (Join-Path $harnessRoot 'packages\experimental\crew-profile') | Out-Null

Invoke-Checked git @('-C', $repository, 'init', '-b', 'main')
Invoke-Checked git @('-C', $repository, 'config', 'user.name', 'DSH Native Crew Smoke')
Invoke-Checked git @('-C', $repository, 'config', 'user.email', 'crew-smoke@example.invalid')
Invoke-Checked git @('-C', $repository, 'add', '--', 'modules', 'shared', 'specs', 'tests')
Invoke-Checked git @('-C', $repository, 'commit', '-m', 'test: seed real-provider Crew smoke')

$prompt = @'
This is a one-shot headless real-provider smoke for the DSH-native Crew. Complete the workflow in this turn and do not call crew_commit.

1. Create specs/greeting-v1.md revision 1. It must require modules/greeting/index.mjs to export function greeting(name), returning exactly `Hello, ${name}!`.
2. Dispatch exactly one module with module_key greeting, write scope modules/greeting, read scopes specs, shared, and modules/greeting, required artifact modules/greeting/index.mjs, and command id syntax-greeting with argv [node, --check, index.mjs], cwd modules/greeting, timeout 10000.
3. Use crew_wait with until manager-action, then crew_status, until the independent reviewer makes the item integration_ready. Address a revision only if the reviewer requests one.
4. Integrate that item with command id integration, argv __INTEGRATION_ARGV__, cwd tests, timeout 10000. Wait again and read status until integration is passed.
5. Do not request a commit. End with the exact marker CREW_REAL_API_OK and a concise evidence summary.
'@
$testIsolation = if ($SingleProcessTests) { 'none' } else { 'process' }
$integrationArgv = if ($SingleProcessTests) {
  '[node, --test-isolation=none, --test, integration.test.mjs]'
} else {
  '[node, --test, integration.test.mjs]'
}
$prompt = $prompt.Replace('__INTEGRATION_ARGV__', $integrationArgv)

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$node = (Get-Command node -ErrorAction Stop).Source
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $node
$startInfo.WorkingDirectory = $repository
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Environment['DEEPSEEK_API_KEY'] = Read-DeepSeekApiKey (Join-Path $harnessRoot '.env')
$startInfo.Environment['DSH_HOME'] = $dshHome
$startInfo.Environment['DSH_AGENTS_HOME'] = $agentsHome
$startInfo.Environment['DSH_PERMISSION_MODE'] = 'workspace-write'
$startInfo.Environment['DSH_TELEMETRY_DISABLED'] = '1'
$startInfo.Environment['AGENT_TEST_REPOSITORY_ROOT'] = $repository
$startInfo.Environment['AGENT_TEST_SESSION_ROOT'] = $sessions
$startInfo.Environment['NODE_OPTIONS'] = @(
  [Environment]::GetEnvironmentVariable('NODE_OPTIONS')
  '--disable-warning=ExperimentalWarning'
  '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Join-String -Separator ' '
$startInfo.ArgumentList.Add($builtCli)
$startInfo.ArgumentList.Add('--profile')
$startInfo.ArgumentList.Add('crew-native')
$startInfo.ArgumentList.Add($prompt)
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
if (-not $process.Start()) {
  throw 'Could not start the built dsh CLI'
}
try {
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  if ($timedOut) {
    $process.Kill($true)
    $process.WaitForExit()
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $dshExitCode = $process.ExitCode
  $transcriptContent = @($stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Join-String -Separator "`n"
  Set-Content -LiteralPath $transcript -Value $transcriptContent -Encoding UTF8 -NoNewline
  if (-not [string]::IsNullOrWhiteSpace($stdout)) { Write-Output $stdout.TrimEnd() }
  if (-not [string]::IsNullOrWhiteSpace($stderr)) { [Console]::Error.WriteLine($stderr.TrimEnd()) }
  if ($timedOut) {
    throw "dsh real-provider smoke exceeded the requested $TimeoutSeconds second budget; transcript retained at $transcript"
  }
} finally {
  if (-not $process.HasExited) {
    $process.Kill($true)
    $process.WaitForExit()
  }
  $process.Dispose()
  $timer.Stop()
}

if ($dshExitCode -ne 0) {
  throw "dsh real-provider smoke exited with code $dshExitCode"
}
Invoke-Checked node @(
  (Join-Path $PSScriptRoot 'verify-run.mjs'),
  $repository,
  $sessions,
  $transcript,
  ([string][math]::Round($timer.Elapsed.TotalSeconds, 3)),
  $testIsolation
)

Write-Output 'CREW_REAL_API_VERIFIED'
