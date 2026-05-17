#!/usr/bin/env python3
"""Compatibility entrypoint for the local XoloLingua service.

The implementation lives in :mod:`xololingua_service.core`. Keeping this thin
module preserves the existing developer command:

    python3 local_service.py
"""

from __future__ import annotations

from xololingua_service.core import *  # noqa: F401,F403 - compatibility re-export
from xololingua_service.http_api import main


if __name__ == "__main__":
    main()
