#!/usr/bin/env python3
"""
Conflict Checker & Parallel Task Scheduler Helper for Paper Scion.
Classifies tasks by subsystem and detects file overlap across active branches.
"""

import sys
import subprocess
import json

SUBSYSTEM_MAP = {
    "shaders": ["app/src/shaders/", "app/src/canvas/postprocessing/"],
    "motion": ["app/src/motion/", "app/src/physics/"],
    "typography": ["app/src/scene/typography.", "app/src/scene/fontEngine.", "app/src/scene/CanvasTypography"],
    "code_export": ["app/src/io/codeExport/", "app/src/tokens/codegen."],
    "core": ["app/src/scene/store.", "app/src/scene/elements.", "app/src/scene/types.", "app/src/scene/geometry."]
}

def get_active_branches():
    cmd = ["git", "branch", "-r", "--list", "origin/feat/*", "origin/fix/*"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    branches = [b.strip() for b in res.stdout.splitlines() if b.strip()]
    return branches

def get_branch_files(branch):
    cmd = ["git", "diff", "--name-only", "origin/main..." + branch]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return set(f.strip() for f in res.stdout.splitlines() if f.strip())

def check_branch_conflicts():
    branches = get_active_branches()
    print(f"Checking {len(branches)} active feature branches for overlap...")
    
    branch_files = {}
    for b in branches:
        branch_files[b] = get_branch_files(b)
        
    conflicts = []
    branch_list = list(branch_files.keys())
    for i in range(len(branch_list)):
        for j in range(i + 1, len(branch_list)):
            b1 = branch_list[i]
            b2 = branch_list[j]
            overlap = branch_files[b1].intersection(branch_files[b2])
            if overlap:
                conflicts.append((b1, b2, overlap))
                
    if not conflicts:
        print("✅ No file conflicts detected between active branches.")
    else:
        print(f"⚠️ Found {len(conflicts)} potential file conflicts:")
        for b1, b2, overlap in conflicts:
            print(f"  - {b1} <--> {b2}:")
            for f in sorted(overlap):
                print(f"      * {f}")
    return len(conflicts)

def classify_issue_subsystem(title, body=""):
    text = (title + " " + body).lower()
    scores = {}
    for sub, paths in SUBSYSTEM_MAP.items():
        score = 0
        if sub in text:
            score += 2
        for kw in ["shader", "glsl", "gpu", "fluid", "particle"] if sub == "shaders" else \
                  ["physics", "motion", "spring", "keyframe", "timeline"] if sub == "motion" else \
                  ["typography", "font", "opentype", "text-on-path", "kinetic"] if sub == "typography" else \
                  ["export", "jsx", "svg", "codegen"] if sub == "code_export" else \
                  ["boolean", "csg", "cag", "compound", "store", "hierarchy"] if sub == "core" else []:
            if kw in text:
                score += 1
        scores[sub] = score
    best = max(scores.items(), key=lambda x: x[1])
    return best[0] if best[1] > 0 else "core"

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "classify":
        title = " ".join(sys.argv[2:])
        print(classify_issue_subsystem(title))
    else:
        check_branch_conflicts()
