"""Explicit OS-native vaults; never fall back to plaintext keyring backends."""

import os
import sys


def windows_vault():
    if sys.platform != "win32":
        raise ValueError(
            "Credential Manager storage is supported only on Windows; use backend environment variables on Linux"
        )
    from keyring.backends.Windows import WinVaultKeyring

    return WinVaultKeyring()


def native_vault():
    if sys.platform == "darwin":
        from keyring.backends.macOS import Keyring

        return Keyring()
    return windows_vault()


def cloud_key():
    key = os.getenv("NIGHTBREW_CLOUD_KEY")
    if key:
        return key
    if sys.platform in ("win32", "darwin"):
        return native_vault().get_password("NightBrew", "cloud-api-key")
    return None


def save_key(key):
    vault = native_vault()
    if key:
        vault.set_password("NightBrew", "cloud-api-key", key)
    else:
        try:
            vault.delete_password("NightBrew", "cloud-api-key")
        except Exception as exc:
            raise ValueError("Could not delete credential") from exc
