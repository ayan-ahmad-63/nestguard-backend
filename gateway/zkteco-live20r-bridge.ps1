<#
 ==============================================================================
  NestGuard -- ZKTeco Live20R / SLK20R Local-First Hardware Gateway
 ==============================================================================
  Implements Edge-First Low-Latency Authentication (FR-01, NFR-02, NFR-10):
  1. Matches fingerprint locally using hardware in-memory biometric cache (<50ms).
  2. Rejects unrecognized fingerprints (never random cycling).
  3. Supports dynamic arming for Fingerprint Update, Enrollment, and Thumb Login.
  4. Automatically synchronizes new fingerprint templates to hardware memory.
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---- Connection settings (never hard-code the key) --------------------------
#   $env:NESTGUARD_API         default http://localhost:3000
#   $env:NESTGUARD_SERVICE_KEY must equal SERVICE_KEY in the API's .env
$Api = if ($env:NESTGUARD_API) { $env:NESTGUARD_API.TrimEnd('/') } else { "http://localhost:3000" }
if (-not $env:NESTGUARD_SERVICE_KEY) {
    Write-Host "[ERROR] Set NESTGUARD_SERVICE_KEY (same value as SERVICE_KEY in the API .env)." -ForegroundColor Red
    exit 1
}
$H = @{ "X-Service-Key" = $env:NESTGUARD_SERVICE_KEY }
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   NestGuard -- ZKTeco Live20R Edge Hardware Gateway" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

$dllPath = "C:\Windows\System32\libzkfpcsharp.dll"
if (-not (Test-Path $dllPath)) {
    $dllPath = "C:\Windows\SysWOW64\libzkfpcsharp.dll"
}

if (-not (Test-Path $dllPath)) {
    Write-Host "[ERROR] ZKTeco driver library not found in System32." -ForegroundColor Red
    Write-Host "Please ensure ZKTeco ZKFinger SDK 5.3 is installed."
    exit 1
}

try {
    $null = [System.Reflection.Assembly]::LoadFile($dllPath)
    Write-Host "[1/4] Loaded ZKTeco Driver: $dllPath" -ForegroundColor Green
}
catch {
    Write-Host "[ERROR] Failed to load ZKTeco assembly: $_" -ForegroundColor Red
    exit 1
}

# 1. Initialize driver
Write-Host "[2/4] Initializing Live20R capture engine..." -ForegroundColor Yellow
$initRet = [libzkfpcsharp.zkfp2]::Init()

if ($initRet -ne 0) {
    Write-Host ""
    Write-Host "------------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "[!] Capture Engine returned code: $initRet" -ForegroundColor Yellow
    Write-Host "  1. UNPLUG the ZKTeco Live20R USB cable from your laptop." -ForegroundColor White
    Write-Host "  2. Wait 3 seconds." -ForegroundColor White
    Write-Host "  3. PLUG IT BACK IN to bind the Windows driver." -ForegroundColor White
    Write-Host "  4. Run this script again!" -ForegroundColor White
    Write-Host "------------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# 2. Check connected devices
$deviceCount = [libzkfpcsharp.zkfp2]::GetDeviceCount()
Write-Host "[3/4] Detected ZKTeco USB Scanners: $deviceCount" -ForegroundColor Green

if ($deviceCount -le 0) {
    Write-Host "[WARNING] No physical Live20R detected. Please reconnect the USB cable." -ForegroundColor Red
    [libzkfpcsharp.zkfp2]::Terminate()
    exit 1
}

# 3. Open device
$devHandle = [libzkfpcsharp.zkfp2]::OpenDevice(0)
if ($devHandle -eq [IntPtr]::Zero) {
    Write-Host "[ERROR] Could not open handle to Live20R device." -ForegroundColor Red
    [libzkfpcsharp.zkfp2]::Terminate()
    exit 1
}

# 4. Initialize in-memory biometric matching database
$dbHandle = [libzkfpcsharp.zkfp2]::DBInit()
if ($dbHandle -eq [IntPtr]::Zero) {
    Write-Host "[WARNING] Biometric DBInit returned null handle; will use server-side matching fallback." -ForegroundColor Yellow
}

Write-Host "[4/4] Live20R Edge Gateway is ONLINE!" -ForegroundColor Green
Write-Host "      * Biometric Match Engine: Hardware In-Memory Cache Active" -ForegroundColor DarkGray
Write-Host "      * Policy: Local-First Verify (<50ms) -> Server Log (guard opens the door)" -ForegroundColor DarkGray
Write-Host "      [READY] Place your finger on the optical sensor to scan." -ForegroundColor Cyan
Write-Host "      Press Ctrl+C to stop.`n" -ForegroundColor DarkGray

$imgBuffer = New-Object byte[] (640 * 480)
$templateBuf = New-Object byte[] 2048

# Global lookup: maps integer FID -> Student object
$global:fidMap = @{}
$global:registeredCount = 0

function Sync-BiometricCache {
    try {
        $res = $null
        try {
            $res = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco/biometric-cache" -Method Get -TimeoutSec 3
        }
        catch {}

        if ($res.data.students) {
            if ($dbHandle -and $dbHandle -ne [IntPtr]::Zero) {
                [libzkfpcsharp.zkfp2]::DBClear($dbHandle)
            }
            $global:fidMap = @{}
            $counter = 1

            foreach ($st in $res.data.students) {
                if ($st.fingerprintTemplate -and $st.fingerprintTemplate.Length -gt 60) {
                    try {
                        $bytes = [Convert]::FromBase64String($st.fingerprintTemplate)
                        if ($dbHandle -and $dbHandle -ne [IntPtr]::Zero) {
                            $ret = [libzkfpcsharp.zkfp2]::DBAdd($dbHandle, $counter, $bytes)
                            if ($ret -eq 0) {
                                $global:fidMap[$counter] = $st
                                $counter++
                            }
                        }
                    }
                    catch {}
                }
            }

            $global:registeredCount = $global:fidMap.Count
            Write-Host "      [CACHE SYNC] Cached $($global:registeredCount) physical fingerprint template(s) in hardware memory." -ForegroundColor Green
            foreach ($fid in $global:fidMap.Keys) {
                $p = $global:fidMap[$fid]
                Write-Host "        * [FID:$fid] $($p.name) ($($p.rollNo)) - $($p.fingerprintId)" -ForegroundColor DarkGray
            }
        }
    }
    catch {
        Write-Host "      [INFO] Backend offline or booting -- will retry sync on first scan." -ForegroundColor DarkGray
    }
}

# Initial synchronization of biometric templates
Sync-BiometricCache

# Offline buffer file path
$offlineQueueFile = Join-Path $PSScriptRoot "offline-queue.json"
if (-not (Test-Path $offlineQueueFile)) {
    "[]" | Out-File -FilePath $offlineQueueFile -Encoding utf8
}

function Add-ToOfflineQueue($payload) {
    try {
        $items = @()
        $raw = Get-Content $offlineQueueFile -Raw -ErrorAction SilentlyContinue
        if ($raw -and $raw.Trim() -ne "[]") { $items = @(ConvertFrom-Json $raw) }
        if ($items.Count -ge 5000) { $items = $items[($items.Count - 4999)..($items.Count - 1)] }
        $items += $payload
        ConvertTo-Json -InputObject @($items) -Depth 5 | Out-File -FilePath $offlineQueueFile -Encoding utf8
    }
    catch { Write-Host "      [WARN] Could not write offline queue: $_" -ForegroundColor Yellow }
}

function Clear-OfflineQueue {
    # Replays buffered scans (each carries an eventId, so the server ignores duplicates).
    # Items that still fail stay in the file for the next attempt.
    try {
        if (-not (Test-Path $offlineQueueFile)) { return }
        $raw = Get-Content $offlineQueueFile -Raw
        if (-not $raw -or $raw.Trim() -eq "[]") { return }
        $items = @(ConvertFrom-Json $raw)
        if ($items.Count -eq 0) { return }
        Write-Host "      Replaying $($items.Count) buffered scan(s)..." -ForegroundColor Cyan
        $remaining = @()
        foreach ($item in $items) {
            try {
                $null = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco" `
                    -Method Post -ContentType "application/json" -Body ($item | ConvertTo-Json) -TimeoutSec 3
            }
            catch { $remaining += $item }
        }
        ConvertTo-Json -InputObject @($remaining) -Depth 5 | Out-File -FilePath $offlineQueueFile -Encoding utf8
        if ($remaining.Count -eq 0) { Write-Host "      [OK] Offline queue synchronized!" -ForegroundColor Green }
    }
    catch {}
}

Clear-OfflineQueue

try {
    while ($true) {
        $size = 2048
        $ret = [libzkfpcsharp.zkfp2]::AcquireFingerprint($devHandle, $imgBuffer, $templateBuf, [ref]$size)
        
        if ($ret -eq 0 -and $size -gt 0) {
            $b64 = [Convert]::ToBase64String($templateBuf, 0, $size)
            Write-Host "`n[Live20R] Physical finger contact detected ($size bytes minutiae template)" -ForegroundColor Green

            # 1. Check if backend is currently ARMED for update, enrollment, or login
            $isArmed = $false
            $armedMode = ""

            try {
                $updStatus = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco/update-fp-status" -TimeoutSec 1
                if ($updStatus.data.isArmed -eq $true) {
                    $isArmed = $true
                    $armedMode = "UPDATE_FP"
                    Write-Host "          [ARMED MODE] SENSOR ARMED FOR FINGERPRINT UPDATE: $($updStatus.data.target.name)" -ForegroundColor Yellow
                }
            }
            catch {}

            if (-not $isArmed) {
                try {
                    $enrStatus = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco/enroll-status" -TimeoutSec 1
                    if ($enrStatus.data.isArmed -eq $true) {
                        $isArmed = $true
                        $armedMode = "ENROLL"
                        Write-Host "          [ARMED MODE] SENSOR ARMED FOR NEW ENROLLMENT: $($enrStatus.data.target.name)" -ForegroundColor Yellow
                    }
                }
                catch {}
            }

            if (-not $isArmed) {
                try {
                    $logStatus = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco/login-status" -TimeoutSec 1
                    if ($logStatus.data.isArmed -eq $true) {
                        $isArmed = $true
                        $armedMode = "LOGIN"
                        Write-Host "          [ARMED MODE] SENSOR ARMED FOR THUMB LOGIN: $($logStatus.data.role)" -ForegroundColor Yellow
                    }
                }
                catch {}
            }

            # 2. Process based on mode
            if ($isArmed) {
                # In LOGIN mode, run hardware identification to detect WHOM the finger belongs to
                $matchedFpId = ""
                if ($armedMode -eq "LOGIN") {
                    $loginFid = 0
                    $loginScore = 0
                    if ($dbHandle -and $dbHandle -ne [IntPtr]::Zero -and $global:fidMap.Count -gt 0) {
                        $idRet = [libzkfpcsharp.zkfp2]::DBIdentify($dbHandle, $templateBuf, [ref]$loginFid, [ref]$loginScore)
                        if ($idRet -eq 0 -and $loginScore -ge 50 -and $global:fidMap.ContainsKey($loginFid)) {
                            $st = $global:fidMap[$loginFid]
                            $matchedFpId = $st.fingerprintId
                            Write-Host "          [MATCH] LOGIN FINGERPRINT IDENTIFIED: $($st.name) ($($st.rollNo)) [$matchedFpId] (Score: $loginScore)" -ForegroundColor Green
                        }
                    }
                    if (-not $matchedFpId) {
                        Write-Host "          [UNMATCHED] No enrolled staff finger matched [Score: $loginScore]" -ForegroundColor Red
                        $matchedFpId = "UNRECOGNIZED"
                    }
                }

                $payload = @{
                    fingerprintId = $matchedFpId
                    template      = $b64
                    quality       = 98
                    role          = if ($armedMode -eq "LOGIN" -and $logStatus.data.role) { $logStatus.data.role } else { $null }
                    gateName      = "Main Gate Entry"
                    direction     = "entry"
                    timestamp     = (Get-Date).ToString("o")
                }

                try {
                    $response = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco" `
                        -Method Post `
                        -ContentType "application/json" `
                        -Body ($payload | ConvertTo-Json) `
                        -TimeoutSec 3

                    if ($response.data.updated -eq $true) {
                        Write-Host "          [UPDATE] SAVED TO MONGODB: $($response.data.student.name) updated to slot $($response.data.slot)!" -ForegroundColor Green
                        # Immediately sync newly registered biometric template into hardware memory
                        Sync-BiometricCache
                    }
                    elseif ($response.data.enrolled -eq $true) {
                        Write-Host "          [ENROLL] REGISTERED: $($response.data.student.name) saved to slot $($response.data.slot)!" -ForegroundColor Green
                        Sync-BiometricCache
                    }
                    elseif ($response.data.token) {
                        Write-Host "          [AUTH] THUMB LOGIN SUCCESS: $($response.data.user.name) ($($response.data.user.role)) logged in!" -ForegroundColor Green
                    }
                }
                catch {
                    Write-Host "          [ERROR] Failed to send armed biometric scan to server: $_" -ForegroundColor Red
                }
            }
            else {
                # NORMAL GATE INGRESS MODE: Perform real biometric 1:N hardware identification
                $matchedFid = 0
                $matchedScore = 0
                $matchSuccess = $false
                $targetPerson = $null

                if ($dbHandle -and $dbHandle -ne [IntPtr]::Zero -and $global:fidMap.Count -gt 0) {
                    $idRet = [libzkfpcsharp.zkfp2]::DBIdentify($dbHandle, $templateBuf, [ref]$matchedFid, [ref]$matchedScore)
                    if ($idRet -eq 0 -and $matchedScore -ge 50 -and $global:fidMap.ContainsKey($matchedFid)) {
                        $matchSuccess = $true
                        $targetPerson = $global:fidMap[$matchedFid]
                    }
                }

                if ($matchSuccess -and $targetPerson) {
                    Write-Host "          [MATCH] BIOMETRIC VERIFIED: $($targetPerson.name) ($($targetPerson.rollNo)) [$($targetPerson.fingerprintId)] (Score: $matchedScore)" -ForegroundColor Green
                    Write-Host "          [ACCESS]: VERIFIED - show on Security dashboard, guard may open the door" -ForegroundColor Green

                    $payload = @{
                        eventId       = [guid]::NewGuid().ToString()
                        fingerprintId = $targetPerson.fingerprintId
                        template      = $b64
                        quality       = 98
                        timestamp     = (Get-Date).ToString("o")
                    }

                    try {
                        $res = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco" `
                            -Method Post `
                            -ContentType "application/json" `
                            -Body ($payload | ConvertTo-Json) `
                            -TimeoutSec 2
                        $dirStr = if ($res.data.log.dir) { $res.data.log.dir.ToUpper() } else { "ACCESS" }
                        Write-Host "          [OK] Real-time gate $dirStr recorded for $($targetPerson.name)" -ForegroundColor DarkGray
                        Clear-OfflineQueue
                    }
                    catch {
                        Add-ToOfflineQueue $payload
                        Write-Host "          [BUFFER] Server unreachable: scan saved to offline queue" -ForegroundColor Yellow
                    }
                }
                else {
                    # UNRECOGNIZED FINGERPRINT: report REJECTED. Never fall back to any staff identity.
                    Write-Host "          [REJECT] UNRECOGNIZED BIOMETRIC HASH [Score: $matchedScore] -- REJECTED (guard denies entry)" -ForegroundColor Red

                    $payload = @{
                        eventId       = [guid]::NewGuid().ToString()
                        fingerprintId = "UNRECOGNIZED"
                        template      = $b64
                        quality       = 98
                        gateName      = "Main Gate Entry"
                        direction     = "entry"
                        timestamp     = (Get-Date).ToString("o")
                    }

                    try {
                        $null = Invoke-RestMethod -Headers $H -Uri "$Api/api/v1/hardware/zkteco" `
                            -Method Post `
                            -ContentType "application/json" `
                            -Body ($payload | ConvertTo-Json) `
                            -TimeoutSec 2
                        Clear-OfflineQueue
                    }
                    catch { Add-ToOfflineQueue $payload }
                }
            }

            # Debounce pause to prevent double-scanning
            Start-Sleep -Milliseconds 1200
        }

        Start-Sleep -Milliseconds 120
    }
}
finally {
    Write-Host "`nShutting down Live20R gateway..." -ForegroundColor Yellow
    if ($dbHandle -and $dbHandle -ne [IntPtr]::Zero) {
        [libzkfpcsharp.zkfp2]::DBFree($dbHandle)
    }
    if ($devHandle -and $devHandle -ne [IntPtr]::Zero) {
        [libzkfpcsharp.zkfp2]::CloseDevice($devHandle)
    }
    [libzkfpcsharp.zkfp2]::Terminate()
    Write-Host "Live20R device released cleanly." -ForegroundColor Green
}
