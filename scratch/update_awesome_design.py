import os
import glob
import re

VERSION = "v2.0.0-pro"

# Premium header for root README
ROOT_HEADER = f"""<div align="center">
  <img src="https://github.com/user-attachments/assets/d012a0d2-cec3-4630-ba5e-acc339dbe6cf" width="100%" alt="Awesome DESIGN.md" style="border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.4);" />
  <br/><br/>
  <h1 align="center">✨ Awesome DESIGN.md <sup><code>{VERSION}</code></sup></h1>
  <p align="center"><strong>The Ultimate Curated Collection of AI-Ready UI/UX Guidelines.</strong></p>
  
  <p align="center">
    <a href="https://awesome.re"><img src="https://awesome.re/badge.svg" alt="Awesome" /></a>
    <img src="https://img.shields.io/badge/DESIGN.md_count-69-10b981?style=for-the-badge&logo=markdown&logoColor=white" alt="Count" />
    <img src="https://img.shields.io/badge/Version-{VERSION}-6366f1?style=for-the-badge&logo=rocket" alt="Version" />
  </p>
</div>

---
"""

# Read root README
root_readme_path = "awesome-design-md-main/README.md"
with open(root_readme_path, "r") as f:
    content = f.read()

parts = content.split("## What is DESIGN.md?")
if len(parts) == 2:
    content = ROOT_HEADER + "\n## What is DESIGN.md?" + parts[1]

with open(root_readme_path, "w") as f:
    f.write(content)

# Update sub-folders
for filepath in glob.glob("awesome-design-md-main/design-md/*/README.md"):
    with open(filepath, "r") as f:
        sub_content = f.read()
    
    brand = os.path.basename(os.path.dirname(filepath)).capitalize()
    
    # Premium sub-header
    SUB_HEADER = f"""<div align="center">
  <h1>🎨 {brand} DESIGN.md</h1>
  <p><strong>Premium UI/UX Design System for AI Agents</strong></p>
  <code>Version: {VERSION}</code>
</div>

---

"""
    
    if "Premium UI/UX Design System" not in sub_content:
        new_content = SUB_HEADER + sub_content
        with open(filepath, "w") as f:
            f.write(new_content)

print("Updated awesome-design-md.")
