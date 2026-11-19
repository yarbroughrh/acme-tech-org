"""Every service's committed copy of the shared library must equal the canonical source (ADR-002)."""

from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
SOURCE = BACKEND / "_shared" / "beacon"
SERVICES = sorted(p.parent.name for p in BACKEND.glob("*/requirements.txt") if not p.parent.name.startswith(("_", ".")))


def _files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*")
            if p.is_file() and "__pycache__" not in p.parts}


def test_services_discovered():
    assert {"auth", "users", "projects"} <= set(SERVICES)


@pytest.mark.parametrize("service", SERVICES)
def test_shared_copy_matches_source(service):
    copy = BACKEND / service / "beacon"
    assert copy.is_dir(), f"backend/{service}/beacon missing: run ./bin/sync-shared.sh"
    source_files, copy_files = _files(SOURCE), _files(copy)
    assert sorted(copy_files) == sorted(source_files), f"file list drift in backend/{service}/beacon: run ./bin/sync-shared.sh"
    drifted = [name for name in source_files if source_files[name] != copy_files[name]]
    assert not drifted, f"backend/{service}/beacon drifted ({drifted}): run ./bin/sync-shared.sh"
