__all__ = ["__version__"]

from importlib.metadata import version as _pkg_version

try:
    __version__ = _pkg_version("readcast")
except Exception:
    __version__ = "0.0.0"

