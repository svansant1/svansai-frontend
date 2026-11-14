"""Runs one approved text snapshot inside an already isolated, offline container."""
import json
import os
import pathlib
import subprocess
import sys

raw = sys.stdin.buffer.read(196609)
if len(raw) > 196608:
    raise ValueError("Snapshot exceeds input limit")
request = json.loads(raw)
root = pathlib.Path("/workspace")
files = request["files"]
if not isinstance(files, list) or not 1 <= len(files) <= 50:
    raise ValueError("Invalid file count")
total = 0
names = set()
for item in files:
    # Materialize only the supplied relative text files; never copy host paths.
    name = item["path"]
    if not isinstance(name, str) or name.startswith("/") or "\\" in name or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("Invalid path")
    if name.lower() in names:
        raise ValueError("Duplicate path")
    names.add(name.lower())
    content = item["content"].encode("utf-8")
    total += len(content)
    if len(content) > 32768 or total > 131072:
        raise ValueError("Snapshot exceeds byte limit")
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as target:
        target.write(content)
entry = request["entrypoint"]
if entry not in [item["path"] for item in files] or not entry.endswith(".py"):
    raise ValueError("Invalid entrypoint")
env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8", "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1"}
if request["mode"] == "tests":
    # Run only the approved test file using the standard-library unittest runner.
    bootstrap = "import runpy,unittest; n=runpy.run_path(__import__('sys').argv[1]); m=type(__import__('sys'))('svans_tests'); m.__dict__.update(n); r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(m)); raise SystemExit(0 if r.testsRun>0 and r.wasSuccessful() else 1)"
    command = [sys.executable, "-B", "-c", bootstrap, entry]
elif request["mode"] == "script":
    command = [sys.executable, "-B", "./" + entry]
else:
    raise ValueError("Invalid mode")
result = subprocess.run(command, cwd=root, env=env, stdin=subprocess.DEVNULL)
sys.exit(result.returncode if result.returncode >= 0 else 1)
