# Server locale per provare l'app sul PC: http://localhost:8765/?demo
# Con -Apri apre anche il browser. Chiudendo la finestra la prova si spegne.
param([switch]$Apri)
$indirizzo = 'http://localhost:8765/?demo'
$root = Join-Path $PSScriptRoot '..\sito' | Resolve-Path
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:8765/')
try { $l.Start() } catch {
  # Già avviata in un'altra finestra: apre solo il browser
  if ($Apri) { Start-Process $indirizzo }
  exit
}
$Host.UI.RawUI.WindowTitle = 'Famiglia - prova'
Write-Host ''
Write-Host '  FAMIGLIA - versione di prova' -ForegroundColor Green
Write-Host "  Indirizzo: $indirizzo"
Write-Host '  Lascia aperta questa finestra mentre usi la prova; chiudila per spegnerla.'
Write-Host '  I dati di prova restano salvati nel browser anche dopo averla chiusa.'
Write-Host ''
if ($Apri) { Start-Process $indirizzo }
$tipi = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.png'='image/png'; '.webmanifest'='application/manifest+json'; '.json'='application/json' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $p) { $p = 'index.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $root $p))
  if ($full.StartsWith($root.Path) -and (Test-Path $full -PathType Leaf)) {
    $b = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full)
    $c.Response.ContentType = if ($tipi[$ext]) { $tipi[$ext] } else { 'application/octet-stream' }
    $c.Response.Headers.Add('Cache-Control', 'no-cache')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
