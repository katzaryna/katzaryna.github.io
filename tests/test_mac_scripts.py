from __future__ import annotations

from pathlib import Path
import re
import subprocess

import pytest


SCRIPTS = sorted((Path(__file__).parent.parent / "scripts" / "mac").glob("*.sh"))
# macOS ships bash 3.2, which in a UTF-8 locale reads the first byte of a
# following non-ASCII character as part of the name: "«$NAME»" fails with
# "NAME?: unbound variable". Such variables must be written as ${NAME}.
BARE_VARIABLE_BEFORE_NON_ASCII = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]")


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda path: path.name)
def test_mac_script_parses_and_braces_variables_before_non_ascii(script: Path) -> None:
    subprocess.run(["bash", "-n", str(script)], check=True)
    for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
        assert not BARE_VARIABLE_BEFORE_NON_ASCII.search(line), f"{script.name}:{number}: use ${{NAME}}"
