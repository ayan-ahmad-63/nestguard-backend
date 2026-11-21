# Gate PC bridge (ZKTeco Live20R)

Runs on the Windows PC the reader is plugged into. It matches fingerprints locally (ZKFinger SDK `DBIdentify`,
templates cached in memory) and reports the result to the API. **No locking hardware**: the screen shows
VERIFIED or REJECTED and the guard opens the door by hand.

## Setup
1. Install the ZKTeco ZKFinger SDK 5.3 (puts `libzkfpcsharp.dll` in System32) and plug in the Live20R.
2. Set the two variables (PowerShell):
   ```powershell
   $env:NESTGUARD_API = "http://localhost:3000"            # or your deployed API URL
   $env:NESTGUARD_SERVICE_KEY = "<SERVICE_KEY from the API .env>"
   ```
3. Run: `powershell -ExecutionPolicy Bypass -File gateway\zkteco-live20r-bridge.ps1`

## What it does
- Pulls decrypted templates from `GET /api/v1/hardware/zkteco/biometric-cache` (service key only) and loads them into the SDK.
- Polls `enroll-status`, `update-fp-status`, `login-status` to know whether the dashboard armed the sensor.
- Normal touch: 1:N match, then `POST /api/v1/hardware/zkteco` with a unique `eventId`.
- API unreachable: the scan is saved to `offline-queue.json` (max 5,000) and replayed after the next successful call;
  the `eventId` makes replays safe (no duplicate logs).

## Not yet tested on hardware
The script was patched (service key header, real offline queue, wording) without a Live20R attached. Run the checklist
in the main README (section "Hardware acceptance test") the first day the device is plugged in.
