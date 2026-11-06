"""Fail the build if anything bundled cannot load on the plant PC.

The plant PC is Windows Server 2016 (build 14393). GitHub's build machines are
newer, so a program that needs a newer Windows still passes every test there and
only fails at the plant. This reads the import table of every .exe, .dll and .pyd:

- no import of a Windows function that build 14393 does not have;
- every Microsoft C++ runtime DLL is in the bundle, because a clean server may
  not have the Visual C++ Redistributable installed.

    python check_windows_compat.py C:\\path\\to\\stage
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pefile

# Added to these DLLs after build 14393. SetThreadDescription is documented as
# 1607, but Server 2016's kernel32 does not export it: that was the plant failure.
TOO_NEW = {
    "SetThreadDescription", "GetThreadDescription",
    "VirtualAlloc2", "VirtualAlloc2FromApp", "MapViewOfFile3", "MapViewOfFile3FromApp",
    "MapViewOfFileNuma2", "UnmapViewOfFile2", "UnmapViewOfFileEx",
    "IsWow64Process2", "GetTempPath2A", "GetTempPath2W", "QueryVirtualMemoryInformation",
    "SetProcessDynamicEnforcedCetCompatibleRanges", "GetMachineTypeAttributes",
    "GetProcessDefaultCpuSetMasks", "SetProcessDefaultCpuSetMasks",
    "GetThreadSelectedCpuSetMasks", "SetThreadSelectedCpuSetMasks",
    "CreateFile3", "CopyFile2Ex", "GetProcessInformationEx",
}
SYSTEM_DLL = re.compile(r"^(kernel32|kernelbase|ntdll|advapi32|user32|ws2_32|bcrypt|bcryptprimitives)\.dll$", re.I)
RUNTIME_DLL = re.compile(r"^(msvcp\d+(_\w+)?|vcruntime\d+(_\w+)?|concrt\d+|vcomp\d+)\.dll$", re.I)
BINARIES = {".exe", ".dll", ".pyd"}


def imports_of(path: Path) -> dict[str, set[str]]:
    """{dll name: function names} that Windows must resolve when the file loads."""
    pe = pefile.PE(str(path), fast_load=True)
    try:
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
        found: dict[str, set[str]] = {}
        for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
            dll = entry.dll.decode("ascii", "replace")
            found.setdefault(dll, set()).update(i.name.decode("ascii", "replace") for i in entry.imports if i.name)
        return found
    finally:
        pe.close()


def problems_in(path: Path, imports: dict[str, set[str]], bundled: set[str]) -> list[str]:
    out = []
    for dll, functions in imports.items():
        if SYSTEM_DLL.match(dll) or dll.lower().startswith("api-ms-win-"):
            for name in sorted(functions & TOO_NEW):
                out.append(f"{path}: needs {name} from {dll}, which Windows Server 2016 does not have")
        if RUNTIME_DLL.match(dll) and dll.lower() not in bundled:
            out.append(f"{path}: needs {dll}, which is not in the bundle")
    return out


def scan(root: Path) -> tuple[int, list[str]]:
    files = [p for p in root.rglob("*") if p.suffix.lower() in BINARIES and p.is_file()]
    bundled = {p.name.lower() for p in files}
    problems: list[str] = []
    checked = 0
    for path in files:
        try:
            imports = imports_of(path)
        except pefile.PEFormatError:
            continue  # a data file or installer stub with a binary extension
        checked += 1
        problems += problems_in(path.relative_to(root), imports, bundled)
    return checked, problems


def main() -> int:
    checked, problems = scan(Path(sys.argv[1]))
    print(f"Checked {checked} program files for Windows Server 2016.")
    for line in problems:
        print("PROBLEM:", line)
    return 1 if problems or not checked else 0


if __name__ == "__main__":
    sys.exit(main())
