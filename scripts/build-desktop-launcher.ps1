# 编译固定路径的 Windows 启动器；不启动应用，不执行测试。
[CmdletBinding()]
param([switch]$CreateDesktopShortcut)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOutput = Join-Path $taskRoot 'DeepSeek-Harness.exe'
$taskBuild = Join-Path $taskRoot 'apps\desktop\.desktop-build\launcher'
$taskSource = Join-Path $taskRoot 'apps\desktop\scripts\LocalLauncher.cs'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) {
    $taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw '未找到 Windows .NET Framework C# 编译器。' }
New-Item -ItemType Directory -Path $taskBuild -Force | Out-Null
$taskIcon = Join-Path $taskRoot 'apps\desktop\assets\icon.ico'
if (-not (Test-Path -LiteralPath $taskIcon)) { & (Join-Path $PSScriptRoot 'build-desktop-icon.ps1') }
$taskBuiltExe = Join-Path $taskBuild 'DeepSeek-Harness.exe'
$taskArguments = @('/nologo', '/codepage:65001', '/target:winexe', '/optimize+', '/reference:System.Windows.Forms.dll', "/out:$taskBuiltExe")
if (Test-Path -LiteralPath $taskIcon) { $taskArguments += "/win32icon:$taskIcon" }
& $taskCompiler @taskArguments $taskSource
if ($LASTEXITCODE -ne 0) { throw "启动器编译失败：$LASTEXITCODE" }
if (Test-Path -LiteralPath $taskOutput) {
    $taskBackup = Join-Path $taskBuild ('previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.exe')
    Copy-Item -LiteralPath $taskOutput -Destination $taskBackup
}
Copy-Item -LiteralPath $taskBuiltExe -Destination $taskOutput -Force
Write-Output "启动器：$taskOutput"
if ($CreateDesktopShortcut) {
    $taskDesktop = [Environment]::GetFolderPath('DesktopDirectory')
    $taskShortcutPath = Join-Path $taskDesktop 'DeepSeek Harness（本地开发）.lnk'
    $taskShell = New-Object -ComObject WScript.Shell
    try {
        $taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
        $taskShortcut.TargetPath = $taskOutput
        $taskShortcut.WorkingDirectory = $taskRoot
        $taskShortcut.IconLocation = "$taskIcon,0"
        $taskShortcut.Description = '启动当前 deepseek-harness 工作目录的桌面构建'
        $taskShortcut.Save()
        Write-Output "桌面快捷方式：$taskShortcutPath"
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) }
}
