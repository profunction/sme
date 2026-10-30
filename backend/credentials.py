"""BYOK: environment injection or explicit Windows Credential Manager only."""

import os
import sys


def windows_vault():
    if sys.platform != "win32":
        raise ValueError(
            "Credential Manager storage is supported only on Windows; use backend environment variables on Linux"
        )
    from keyring.backends.Windows import WinVaultKeyring

    return WinVaultKeyring()


def cloud_key():
    key = os.getenv("NIGHTBREW_CLOUD_KEY")
    if key:
        return key
    if sys.platform == "win32":
        return windows_vault().get_password("NightBrew", "cloud-api-key")
    return None


def save_key(key):
    vault = windows_vault()
    if key:
        vault.set_password("NightBrew", "cloud-api-key", key)
    else:
        try:
            vault.delete_password("NightBrew", "cloud-api-key")
        except Exception as exc:
            raise ValueError("Could not delete credential") from exc
