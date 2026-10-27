# Локальный сервер для приложения «Клёв».
# Запускается из start.bat и открывает приложение в браузере по адресу http://localhost:8000
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $root.EndsWith('\')) { $root = $root + '\' }
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.png' = 'image/png'
  '.json' = 'application/json'
  '.webmanifest' = 'application/manifest+json'
  '.md' = 'text/plain; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'
}

$listener = $null
$port = 0
foreach ($p in 8000..8010) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch { }
}
if (-not $listener) {
  Write-Host 'Не удалось запустить: порты 8000-8010 заняты. Закройте другие программы-серверы и попробуйте снова.' -ForegroundColor Red
  Read-Host 'Нажмите Enter, чтобы закрыть'
  exit 1
}

$url = "http://localhost:$port/"
Write-Host ''
Write-Host "  Клёв открыт по адресу $url" -ForegroundColor Green
Write-Host '  Не закрывайте это окно, пока пользуетесь приложением.'
Write-Host '  Закончили — просто закройте окно.'
Write-Host ''
Start-Process $url

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '' -or $rel.EndsWith('/')) { $rel = $rel + 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.AddHeader('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch {
  } finally {
    try { $res.Close() } catch { }
  }
}
