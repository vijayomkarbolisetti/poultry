import re
import sys

path = sys.argv[1]
xml = open(path, encoding="utf-8").read()
print("nodes", xml.count("<node"), "bytes", len(xml))
for m in re.finditer(r"<node[^>]+>", xml):
    n = m.group(0)
    text = re.search(r'text="([^"]*)"', n)
    cls = re.search(r'class="([^"]*)"', n)
    bounds = re.search(r'bounds="([^"]*)"', n)
    t = text.group(1) if text else ""
    c = cls.group(1).split(".")[-1] if cls else ""
    b = bounds.group(1) if bounds else ""
    if t or "EditText" in c:
        print(repr(t), "|", c, "|", b)
