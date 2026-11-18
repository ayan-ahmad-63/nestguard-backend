"""
NestGuard — ZKTeco Live20R Python DLL Driver Bridge
═══════════════════════════════════════════════════
Direct hardware bridge using ZKTeco's native C/C++ SDK (libzkfp.dll).

Prerequisites:
  1. ZKTeco Live20R plugged into USB
  2. ZKFinger SDK installed (libzkfp.dll in System32 or script folder)
  3. pip install requests

Usage:
  python src/scripts/zkteco_driver_bridge.py
"""

import sys
import time
import json
import ctypes
import os

try:
    import requests
except ImportError:
    print("Please install requests: pip install requests")
    sys.exit(1)

NESTGUARD_ENDPOINT = "http://localhost:3000/api/v1/hardware/zkteco"

# Search common paths for ZKTeco native library
DLL_PATHS = [
    "libzkfp.dll",
    r"C:\Windows\System32\libzkfp.dll",
    r"C:\Program Files\ZKTeco\ZKFinger SDK\libzkfp.dll",
    r"C:\Program Files (x86)\ZKTeco\ZKFinger SDK\libzkfp.dll",
]

zkfp = None
for path in DLL_PATHS:
    if os.path.exists(path):
        try:
            zkfp = ctypes.cdll.LoadLibrary(path)
            print(f"✓ Loaded ZKTeco SDK from: {path}")
            break
        except Exception as e:
            pass

if not zkfp:
    print("==================================================")
    print("ZKTeco Live20R Driver Setup")
    print("==================================================")
    print("libzkfp.dll not found in default paths.")
    print("Please place libzkfp.dll in this folder or install")
    print("the ZKTeco ZKFinger SDK 5.3 Windows package.")
    print("==================================================")
    sys.exit(1)

def main():
    # 1. Initialize ZKTeco library
    ret = zkfp.ZKFPM_Init()
    if ret != 0:
        print(f"Failed to initialize ZKTeco SDK. Error code: {ret}")
        return

    # 2. Get device count
    device_count = zkfp.ZKFPM_GetDeviceCount()
    print(f"ZKTeco Devices detected: {device_count}")
    if device_count <= 0:
        print("No physical Live20R device found. Please connect USB cable.")
        zkfp.ZKFPM_Terminate()
        return

    # 3. Open first device
    h_device = zkfp.ZKFPM_OpenDevice(0)
    if not h_device:
        print("Failed to open Live20R device.")
        zkfp.ZKFPM_Terminate()
        return

    print("\n✓ Live20R connected and ready!")
    print("Touch the sensor with your finger to scan...\n")

    img_buf = (ctypes.c_ubyte * (640 * 480))()
    template_buf = (ctypes.c_ubyte * 2048)()
    template_len = ctypes.c_uint(2048)

    try:
        while True:
            # 4. Acquire fingerprint
            ret = zkfp.ZKFPM_AcquireFingerprint(
                h_device,
                img_buf,
                len(img_buf),
                template_buf,
                ctypes.byref(template_len)
            )

            if ret == 0:
                print("Finger detected! Sending to NestGuard...")
                payload = {
                    "fingerprintId": "FP-001",
                    "gateName": "Main Gate",
                    "direction": "entry",
                    "quality": 99
                }
                try:
                    res = requests.post(NESTGUARD_ENDPOINT, json=payload, timeout=2)
                    print(f"Recorded by NestGuard: {res.status_code}")
                except Exception as e:
                    print(f"Could not reach NestGuard backend: {e}")
                time.sleep(1.5)  # debounce

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\nStopping Live20R bridge...")
    finally:
        zkfp.ZKFPM_CloseDevice(h_device)
        zkfp.ZKFPM_Terminate()

if __name__ == "__main__":
    main()
