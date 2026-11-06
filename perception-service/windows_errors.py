"""Stop Windows showing error boxes for a program that cannot start.

With nobody at the plant to click OK, such a box leaves the program hanging and
its files locked. The setting passes to every program started from this one, so
a failure comes back as an exit code that the service can report instead.
"""
from __future__ import annotations

import sys

SEM_FAILCRITICALERRORS = 0x0001
SEM_NOGPFAULTERRORBOX = 0x0002
SEM_NOOPENFILEERRORBOX = 0x8000
QUIET = SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX


def suppress_error_boxes() -> None:
    if sys.platform != "win32":
        return
    import ctypes

    kernel32 = ctypes.windll.kernel32
    kernel32.SetErrorMode(kernel32.GetErrorMode() | QUIET)
