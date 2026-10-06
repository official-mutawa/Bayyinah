# Render PDF pages to PNG with the Windows built-in PDF renderer (Windows.Data.Pdf). No installs.
# Usage: powershell -File render-pages.ps1 -Pdf <path> -Out <dir> -From <1-based> -To <1-based> [-Width 2200]
param(
  [Parameter(Mandatory = $true)][string]$Pdf,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$From = 1,
  [int]$To = 0,
  [int]$Width = 2200,
  [switch]$CountOnly
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]

$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, [Type]$type) {
  $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
function AwaitAction($action) { $t = $asTaskAction.Invoke($null, @($action)); $t.Wait(-1) | Out-Null }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Pdf)) ([Windows.Storage.StorageFile])
$doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
if ($CountOnly) { Write-Output $doc.PageCount; exit 0 }
if ($To -le 0 -or $To -gt $doc.PageCount) { $To = $doc.PageCount }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
for ($i = $From; $i -le $To; $i++) {
  $page = $doc.GetPage($i - 1)
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = [uint32]$Width
  $opts.DestinationHeight = [uint32][math]::Round($Width * $page.Size.Height / $page.Size.Width)
  $opts.BackgroundColor = [Windows.UI.Color]::FromArgb(255, 255, 255, 255)
  $opts.BitmapEncoderId = [Windows.Graphics.Imaging.BitmapEncoder]::PngEncoderId
  $mem = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  AwaitAction ($page.RenderToStreamAsync($mem, $opts))
  $src = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($mem.GetInputStreamAt(0))
  $dst = [System.IO.File]::Create((Join-Path $Out ("p{0:D4}.png" -f $i)))
  $src.CopyTo($dst); $dst.Close(); $src.Close(); $mem.Dispose(); $page.Dispose()
}
