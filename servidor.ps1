# ============================================================
#  Servidor local para "Campo de flores para Gina"
#  No necesita permisos de administrador (usa TcpListener).
#  Uso: clic derecho sobre este archivo > "Ejecutar con PowerShell"
#       o en una terminal:  powershell -ExecutionPolicy Bypass -File servidor.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
$port = 5500
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

# Detectar IP local (WiFi) para acceder desde el celular
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress)

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
$listener.Start()

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "   Campo de flores para Gina - servidor listo" -ForegroundColor Yellow
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "   En esta PC:      http://localhost:$port" -ForegroundColor Cyan
if ($ip) {
  Write-Host "   En el CELULAR:   http://$ip`:$port" -ForegroundColor Green
  Write-Host "                    (el celular debe estar en la MISMA WiFi)" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "   Para detener el servidor: cierra esta ventana o pulsa Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.mp3'  = 'audio/mpeg'
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { $client.Close(); continue }

      # "GET /ruta HTTP/1.1"
      $parts = $requestLine.Split(' ')
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
      $rawPath = $rawPath.Split('?')[0]
      $rel = [System.Uri]::UnescapeDataString($rawPath.TrimStart('/'))
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }

      $path = Join-Path $root $rel
      $full = [System.IO.Path]::GetFullPath($path)

      # Evitar salir de la carpeta
      if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
        $full = $null
      }

      if ($full -and (Test-Path $full -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($bytes, 0, $bytes.Length)
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 - no encontrado")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($body, 0, $body.Length)
      }
      $stream.Flush()
    } catch {
      # ignorar errores de conexiones sueltas
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
