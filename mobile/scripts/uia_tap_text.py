"""Find a clickable ancestor for a text label and print center coords."""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET


def main() -> None:
    path, label = sys.argv[1], sys.argv[2]
    root = ET.parse(path).getroot()
    parent: dict = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    target = None
    for node in root.iter("node"):
        if (node.attrib.get("text") or "").strip() == label:
            target = node
            break
    if target is None:
        raise SystemExit(f"label not found: {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            assert match
            x = (int(match.group(1)) + int(match.group(3))) // 2
            y = (int(match.group(2)) + int(match.group(4))) // 2
            print(f"{x} {y}")
            return
        cur = parent.get(cur)
    raise SystemExit(f"no clickable ancestor for: {label}")


if __name__ == "__main__":
    main()
