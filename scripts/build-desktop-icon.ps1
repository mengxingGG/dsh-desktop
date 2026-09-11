# 将应用图标的 PNG 源文件编码为 Windows 多尺寸 ICO；不修改原始设计。
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPng = Join-Path $taskRoot 'apps\desktop\assets\icon.png'
$taskIco = Join-Path $taskRoot 'apps\desktop\assets\icon.ico'
Add-Type -AssemblyName System.Drawing
$taskImage = [Drawing.Image]::FromFile($taskPng)
$taskFrames = [Collections.Generic.List[byte[]]]::new()
$taskSizes = @(16, 24, 32, 48, 64, 128, 256)
try {
    foreach ($taskSize in $taskSizes) {
        $taskBitmap = [Drawing.Bitmap]::new($taskSize, $taskSize)
        $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
        $taskBuffer = [IO.MemoryStream]::new()
        try {
            $taskGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $taskGraphics.DrawImage($taskImage, 0, 0, $taskSize, $taskSize)
            $taskBitmap.Save($taskBuffer, [Drawing.Imaging.ImageFormat]::Png)
            $taskFrames.Add($taskBuffer.ToArray())
        } finally { $taskBuffer.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose() }
    }
} finally { $taskImage.Dispose() }
$taskStream = [IO.File]::Create($taskIco)
$taskWriter = [IO.BinaryWriter]::new($taskStream)
try {
    $taskWriter.Write([uint16]0)
    $taskWriter.Write([uint16]1)
    $taskWriter.Write([uint16]$taskSizes.Count)
    $taskOffset = 6 + 16 * $taskSizes.Count
    for ($taskIndex = 0; $taskIndex -lt $taskSizes.Count; $taskIndex++) {
        $taskDimension = if ($taskSizes[$taskIndex] -eq 256) { 0 } else { $taskSizes[$taskIndex] }
        $taskWriter.Write([byte]$taskDimension)
        $taskWriter.Write([byte]$taskDimension)
        $taskWriter.Write([uint16]0)
        $taskWriter.Write([uint16]1)
        $taskWriter.Write([uint16]32)
        $taskWriter.Write([uint32]$taskFrames[$taskIndex].Length)
        $taskWriter.Write([uint32]$taskOffset)
        $taskOffset += $taskFrames[$taskIndex].Length
    }
    foreach ($taskFrame in $taskFrames) { $taskWriter.Write($taskFrame) }
} finally { $taskWriter.Dispose(); $taskStream.Dispose() }
Write-Output "应用图标：$taskIco"
