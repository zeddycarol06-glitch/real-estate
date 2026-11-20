# Ensures a local MongoDB is accepting connections on port 27017 before the
# EstatePro server starts. The server needs it; without it `node server.js`
# exits immediately with a connection error.
#
# If MongoDB is already running (the normal case on this machine, where it is
# installed as the "MongoDB" Windows service) this does nothing and exits 0.

$ErrorActionPreference = 'Stop'
$mongoPort = 27017

function Test-MongoPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $mongoPort)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

if (Test-MongoPort) {
    Write-Host "MongoDB is already accepting connections on port $mongoPort."
    exit 0
}

Write-Host "MongoDB is not reachable on port $mongoPort. Trying to start it..."

$service = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Running') {
        Start-Service -Name 'MongoDB'
    }

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-MongoPort) {
            Write-Host 'MongoDB is ready.'
            exit 0
        }
    }

    Write-Error "The MongoDB service is running but is not accepting connections on port $mongoPort."
    exit 1
}

$mongod = Get-Command mongod -ErrorAction SilentlyContinue
if ($mongod) {
    $dbPath = Join-Path $env:USERPROFILE 'data\db'
    if (-not (Test-Path $dbPath)) {
        New-Item -ItemType Directory -Path $dbPath -Force | Out-Null
    }

    Start-Process -FilePath $mongod.Source -ArgumentList '--dbpath', $dbPath -WindowStyle Hidden

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-MongoPort) {
            Write-Host 'MongoDB is ready.'
            exit 0
        }
    }

    Write-Error "mongod started but is not accepting connections on port $mongoPort."
    exit 1
}

Write-Error @"
MongoDB is not running and no MongoDB service or mongod executable was found.
Install MongoDB, or point EstatePro at another database by setting MONGODB_URI
in a .env file (see .env.example) to a reachable MongoDB connection string.
"@
exit 1
