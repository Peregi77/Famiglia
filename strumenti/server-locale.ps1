# Server locale per provare l'app: http://localhost:8765/?demo
$root = Join-Path $PSScriptRoot '..\sito' | Resolve-Path
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:8765/')
$l.Start()
Write-Host "Famiglia: http://localhost:8765/?demo"
$tipi = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.png'='image/png'; '.webmanifest'='application/manifest+json'; '.json'='application/json' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $p) { $p = 'index.html' }
  $f = Join-Path $root $p
  $full = [IO.Path]::GetFullPath($f)
  if ($full.StartsWith($root.Path) -and (Test-Path $full -PathType Leaf)) {
    $b = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full)
    $c.Response.ContentType = if ($tipi[$ext]) { $tipi[$ext] } else { 'application/octet-stream' }
    $c.Response.Headers.Add('Cache-Control', 'no-cache')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
