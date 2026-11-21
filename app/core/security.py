import base64
import os
import time

import bcrypt
import jwt
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

ENC_PREFIX = "enc:v1:"


# ── Passwords ───────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(get_settings().bcrypt_rounds)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# ── JWT ─────────────────────────────────────────────────────────────────────
def create_token(user: dict) -> str:
    s = get_settings()
    now = int(time.time())
    payload = {**user, "iat": now, "exp": now + s.jwt_expires_hours * 3600}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    """Raises jwt.PyJWTError on a bad or expired token."""
    return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])


# ── Fingerprint template encryption (AES-256-GCM) ───────────────────────────
def _aes() -> AESGCM:
    return AESGCM(bytes.fromhex(get_settings().template_encryption_key))


def encrypt_template(plain: str) -> str:
    if not plain:
        return ""
    iv = os.urandom(12)
    ct = _aes().encrypt(iv, plain.encode(), None)  # ciphertext || 16-byte tag
    return f"{ENC_PREFIX}{base64.b64encode(iv).decode()}.{base64.b64encode(ct).decode()}"


def decrypt_template(stored: str) -> str:
    """Decrypts a stored template. Legacy plaintext values pass through unchanged."""
    if not stored or not stored.startswith(ENC_PREFIX):
        return stored or ""
    iv_b64, ct_b64 = stored[len(ENC_PREFIX):].split(".", 1)
    try:
        return _aes().decrypt(base64.b64decode(iv_b64), base64.b64decode(ct_b64), None).decode()
    except InvalidTag:
        return ""  # wrong key or tampered data: treat as no template


def is_real_template(value: str) -> bool:
    """A usable Live20R template is long base64; placeholders are not."""
    if not value or len(value) <= 60:
        return False
    try:
        base64.b64decode(value, validate=True)
    except ValueError:
        return False
    return True
