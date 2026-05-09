"""Resolve opaque secret refs to plaintext at dispatch time only.

Refs we support:
  keychain:<service>           -> macOS `security find-generic-password -s <service> -w`
  op://<vault>/<item>/<field>  -> 1Password CLI `op read op://...`

Plaintext is returned to the caller and MUST NOT be logged, persisted, or
echoed back to clients. Phase 4 calls this immediately before exec.
"""
import shutil
import subprocess


class SecretResolutionError(RuntimeError):
    pass


def resolve_secret_ref(ref: str) -> str:
    if not ref:
        raise ValueError("empty secret ref")
    if ref.startswith("keychain:"):
        service = ref[len("keychain:"):]
        if not service:
            raise ValueError("keychain ref missing service name")
        if shutil.which("security") is None:
            raise SecretResolutionError("`security` CLI not available (macOS only)")
        try:
            out = subprocess.run(
                ["security", "find-generic-password", "-s", service, "-w"],
                capture_output=True, text=True, check=True, timeout=10,
            )
            return out.stdout.rstrip("\n")
        except subprocess.CalledProcessError as e:
            raise SecretResolutionError(
                f"keychain lookup failed for service={service!r}: {e.stderr.strip()}"
            ) from e
    if ref.startswith("op://"):
        if shutil.which("op") is None:
            raise SecretResolutionError("`op` (1Password CLI) not on PATH")
        try:
            out = subprocess.run(
                ["op", "read", ref],
                capture_output=True, text=True, check=True, timeout=10,
            )
            return out.stdout.rstrip("\n")
        except subprocess.CalledProcessError as e:
            raise SecretResolutionError(
                f"1Password read failed for {ref}: {e.stderr.strip()}"
            ) from e
    raise ValueError(f"unsupported secret ref scheme: {ref.split(':',1)[0]!r}")


def validate_secret_ref(ref: str) -> None:
    """Cheap structural validation — does NOT touch keychain or 1Password."""
    if not ref:
        raise ValueError("empty secret ref")
    if ref.startswith("keychain:"):
        if not ref[len("keychain:"):]:
            raise ValueError("keychain ref missing service name")
        return
    if ref.startswith("op://"):
        rest = ref[len("op://"):]
        if rest.count("/") < 2 or any(not p for p in rest.split("/")):
            raise ValueError("op:// ref must have form op://<vault>/<item>/<field>")
        return
    raise ValueError(f"unsupported secret ref scheme: {ref.split(':',1)[0]!r}")
