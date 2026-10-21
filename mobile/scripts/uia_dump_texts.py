"""Dump text nodes from a uiautomator XML dump."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET


def main() -> None:
    path = sys.argv[1]
    root = ET.parse(path).getroot()
    for node in root.iter("node"):
        text = (node.attrib.get("text") or "").strip()
        if text:
            print(repr(text))


if __name__ == "__main__":
    main()
