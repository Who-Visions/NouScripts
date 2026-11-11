#!/usr/bin/env python3
"""Draft one React component with a free NouGenOpen lane (OpenRouter), for review by a human or Claude.

    draft_component.py <Name> "<component-specific spec>" [--model slug]

Sends design/react_spec.md + the old renderer (reference) + ui/src/lib/useNou.js + ui/src/lib/text.js,
writes ui/src/components/<Name>.jsx, and prints the lane result line.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPEN = os.path.expanduser("~/The Observatory/NouGen/NouGenOpen")
SHARDS = os.path.expanduser("~/The Observatory/NouGen/nougenshards")


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def main():
    name, spec = sys.argv[1], sys.argv[2]
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "nvidia/nemotron-3-ultra-550b-a55b:free"
    git_show = lambda p: subprocess.run(["git", "-C", ROOT, "show", f"origin/main:{p}"], capture_output=True, text=True).stdout
    prompt = "\n\n".join([
        read("design/react_spec.md"),
        f"# THIS FILE: ui/src/components/{name}.jsx\n{spec}",
        "# useNou.js (the `nou` prop)\n" + read("ui/src/lib/useNou.js"),
        "# text.js\n" + read("ui/src/lib/text.js"),
        "# REFERENCE index.html (old)\n" + git_show("src/renderer/index.html"),
        "# REFERENCE app.js (old)\n" + git_show("src/renderer/app.js"),
        f"Now write the complete ui/src/components/{name}.jsx. Output only the code.",
    ])
    env = {**os.environ, "PYTHONPATH": os.path.join(OPEN, "src"), "NOUGEN_SRC": os.path.join(SHARDS, "src")}
    r = subprocess.run([os.path.join(SHARDS, ".venv/bin/python"), "-m", "nougen_open.cli", "ask", "--provider", "openrouter",
                        "--model", model, "--system", "You are a senior React engineer. You write correct, complete, production code.",
                        prompt], capture_output=True, text=True, env=env, cwd=OPEN, timeout=900)
    out = r.stdout
    m = re.search(r"```(?:jsx|javascript|js|tsx)?\n([\s\S]*?)```", out)
    code = m.group(1) if m else "\n".join(l for l in out.splitlines() if not l.startswith("NouGen vault resolved"))
    dest = os.path.join(ROOT, "ui/src/components", f"{name}.jsx")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(code.strip() + "\n")
    print(f"{name}: {len(code.splitlines())} lines via openrouter/{model} -> {os.path.relpath(dest, ROOT)}"
          + (f" (stderr: {r.stderr.strip().splitlines()[-1][:120]})" if r.returncode else ""))


if __name__ == "__main__":
    main()
