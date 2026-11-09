from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

from app.services.notification_service import _normalise_pem


def _pem():
    k = ec.generate_private_key(ec.SECP256R1())
    return k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def test_flattened_pem_is_readable_again():
    pem = _pem()
    flat = pem.replace("\n", " ").strip()            # line breaks lost when saved as a one-line secret
    joined = pem.replace("\n", "")                    # or removed entirely
    escaped = pem.replace("\n", "\n")                # or written as literal \n
    for bad in (flat, joined, escaped):
        fixed = _normalise_pem(bad)
        serialization.load_pem_private_key(fixed.encode(), password=None)   # raises if unreadable
    assert _normalise_pem(pem) == pem.strip() or serialization.load_pem_private_key(_normalise_pem(pem).encode(), None)
