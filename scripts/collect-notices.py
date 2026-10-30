"""Collect installed public license texts; never inspect credentials or process environment."""

import json
from importlib import metadata
from pathlib import Path

output = [
    "NightBrew third-party dependency notices\nGenerated from installed distributions. See LICENSE_AUDIT.md for review scope.\n"
]
seen = set()


def include(path):
    path = Path(path)
    if not path.is_file() or path in seen or path.stat().st_size > 2 * 1024**2:
        return
    seen.add(path)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeError:
        return
    output.append(
        "\n--- " + str(path).replace(str(Path.cwd()), ".") + " ---\n" + text + "\n"
    )


for distribution in sorted(
    metadata.distributions(), key=lambda d: d.metadata["Name"].lower()
):
    output.append(
        "\nPACKAGE " + distribution.metadata["Name"] + " " + distribution.version + "\n"
    )
    output.append(
        distribution.metadata.get("License-Expression")
        or distribution.metadata.get("License")
        or "See distribution notices"
    )
    for file in distribution.files or []:
        if any(
            term in file.name.lower()
            for term in ("license", "licence", "copying", "notice")
        ):
            include(distribution.locate_file(file))

lock = json.loads(Path("package-lock.json").read_text())
for location, package in lock["packages"].items():
    if not location:
        continue
    directory = Path(location)
    output.append(
        "\nNPM "
        + location
        + " "
        + package.get("version", "")
        + " "
        + str(package.get("license", ""))
        + "\n"
    )
    if directory.is_dir():
        for path in directory.iterdir():
            if path.name.lower().startswith(
                ("license", "licence", "notice", "copying")
            ):
                include(path)

Path("build").mkdir(exist_ok=True)
Path("build/THIRD-PARTY-NOTICES.txt").write_text("\n".join(output), encoding="utf-8")
