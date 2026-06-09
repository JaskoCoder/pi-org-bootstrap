#!/usr/bin/env python3
"""
Memory Compaction Script for UniBrain Agent Memory Files.

Reads an agent memory file, extracts structured sections and tagged entries,
produces a compressed active zone (under 1500 chars) with full archive below.
"""

import re
import sys
import os
from pathlib import Path

MAX_ACTIVE_CHARS = 1500
ARCHIVE_MARKER = "---\n# Archived (full detail below)\n\n"

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def extract_section(content, section_name):
    """Extract a ## section from content, return (header, body) or None."""
    # Match ## Section Name ... until next ## at same level or end
    pattern = rf'^## {re.escape(section_name)}\s*\n(.*?)(?=^## |\Z)'
    match = re.search(pattern, content, re.MULTILINE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return None

def extract_title(content):
    """Extract the # Title line."""
    match = re.match(r'^#\s+(.+)', content)
    if match:
        return match.group(1).strip()
    return "Agent Memory"

def extract_tagged_entries(content):
    """Extract all [PATTERN], [GOTCHA], [LESSON], [DECISION], [SECURITY] tagged entries."""
    tags = ['PATTERN', 'GOTCHA', 'LESSON', 'DECISION', 'SECURITY']
    entries = {tag: [] for tag in tags}
    
    # Pattern 1: - **[TAG]**: description
    for tag in tags:
        pattern = rf'-\s*\*\*\[{tag}\]\*\*:\s*(.+?)(?:\n|$)'
        matches = re.findall(pattern, content)
        for m in matches:
            entry = m.strip()
            if entry and entry not in entries[tag]:
                entries[tag].append(entry)
    
    # Pattern 2: [TAG]: description (inline)
    for tag in tags:
        pattern = rf'\[{tag}\]:\s*(.+?)(?:\n|$)'
        matches = re.findall(pattern, content)
        for m in matches:
            entry = m.strip()
            if entry and entry not in entries[tag]:
                entries[tag].append(entry)
    
    # Pattern 3: Key pattern:/Key gotcha:/Key decision: etc.
    key_patterns = {
        'PATTERN': [r'(?:Key|New) pattern:\s*(.+?)(?:\n|$)'],
        'GOTCHA': [r'(?:Key|New) gotcha:\s*(.+?)(?:\n|$)', r'GOTCHA\s*[—–-]\s*(.+?)(?:\n|$)'],
        'LESSON': [r'(?:Key|New) lesson:\s*(.+?)(?:\n|$)'],
        'DECISION': [r'(?:Key|New) decision:\s*(.+?)(?:\n|$)'],
    }
    for tag, pats in key_patterns.items():
        for pat in pats:
            matches = re.findall(pat, content, re.IGNORECASE)
            for m in matches:
                entry = m.strip()
                if entry and entry not in entries[tag]:
                    entries[tag].append(entry)
    
    return entries

def extract_history_entries(content):
    """Extract dated entries: ## [YYYY-MM-DD] brief summary."""
    pattern = r'^##\s+\[?(\d{4}-\d{2}-\d{2})\]?\s+(.+?)$'
    matches = re.findall(pattern, content, re.MULTILINE)
    # Return list of (date, title) newest first (they're already newest-first in file)
    seen = set()
    result = []
    for date, title in matches:
        key = f"{date} {title[:50]}"
        if key not in seen:
            seen.add(key)
            result.append((date, title.strip()))
    return result

def extract_top_level_sections(content):
    """Extract top-level ## sections that are NOT dated entries."""
    sections = {}
    # Find all ## sections
    pattern = r'^##\s+(.+?)\s*\n'
    matches = re.finditer(pattern, content, re.MULTILINE)
    for match in matches:
        name = match.group(1).strip()
        # Skip dated entries
        if re.match(r'\[?\d{4}-\d{2}-\d{2}\]?', name):
            continue
        sections[name] = match.start()
    return sections

def has_archive_marker(content):
    """Check if file already has an archive marker."""
    return '\n---\n' in content or '\n# Archived' in content

def get_pre_archive_content(content):
    """If file already has archive marker, get content before it."""
    # Look for the archive marker
    marker_patterns = [
        r'\n---\n# Archived',
        r'\n---\n# ARCHIVED', 
        r'\n---\n## Archived',
    ]
    for pat in marker_patterns:
        match = re.search(pat, content)
        if match:
            return content[:match.start()]
    # Fallback: look for just ---
    parts = content.split('\n---\n', 1)
    if len(parts) == 2:
        return parts[0]
    return content

def get_archive_content(content):
    """Get existing archive content if any."""
    marker_patterns = [
        r'\n---\n# Archived.*?\n\n(.*)',
        r'\n---\n# ARCHIVED.*?\n\n(.*)',
        r'\n---\n## Archived.*?\n\n(.*)',
    ]
    for pat in marker_patterns:
        match = re.search(pat, content, re.DOTALL)
        if match:
            return match.group(1)
    return None

def compact_file(filepath, dry_run=False):
    """Compact a single memory file."""
    content = read_file(filepath)
    original_size = len(content)
    title = extract_title(content)
    
    # Check if already compacted — if so, re-compact from archive
    if has_archive_marker(content):
        pre_archive = get_pre_archive_content(content)
        archive = get_archive_content(content)
        if archive:
            # Use the full archive as source for re-compaction
            source_content = archive
        else:
            source_content = content
    else:
        source_content = content
        archive = None
    
    # Extract structured sections from pre-archive content first
    pre_archive_sections = {}
    for section in ['Mental Model', 'Key Decisions', 'Active Work', 'Gotchas & Learnings']:
        sec = extract_section(pre_archive if has_archive_marker(content) else content, section)
        if sec:
            pre_archive_sections[section] = sec
    
    # Extract tagged entries from FULL source content
    tagged = extract_tagged_entries(source_content)
    
    # Extract history entries from FULL source content
    history = extract_history_entries(source_content)
    
    # Build active zone
    lines = []
    lines.append(f"# {title}")
    lines.append("")
    
    # Mental Model
    if 'Mental Model' in pre_archive_sections:
        lines.append("## Mental Model")
        lines.append("")
        lines.append(pre_archive_sections['Mental Model'])
        lines.append("")
    
    # Key Decisions (trim to most recent 5 if long)
    if 'Key Decisions' in pre_archive_sections:
        lines.append("## Key Decisions")
        lines.append("")
        kd = pre_archive_sections['Key Decisions']
        kd_lines = kd.split('\n')
        if len(kd_lines) > 8:  # Keep only first 8 lines
            kd = '\n'.join(kd_lines[:8])
        lines.append(kd)
        lines.append("")
    
    # Active Work
    if 'Active Work' in pre_archive_sections:
        lines.append("## Active Work")
        lines.append("")
        lines.append(pre_archive_sections['Active Work'])
        lines.append("")
    
    # Gotchas & Learnings — compressed from tags
    lines.append("## Gotchas & Learnings")
    lines.append("")
    
    tag_order = ['PATTERN', 'GOTCHA', 'LESSON', 'DECISION', 'SECURITY']
    any_tags = False
    for tag in tag_order:
        for entry in tagged[tag]:
            lines.append(f"- **[{tag}]**: {entry}")
            any_tags = True
    if not any_tags:
        lines.append("- (none yet)")
    lines.append("")
    
    # History Summary
    lines.append("## History")
    lines.append("")
    for date, title_text in history:
        lines.append(f"- [{date}] {title_text}")
    
    active_zone = '\n'.join(lines)
    
    # Trim if over 1500 chars — remove oldest history entries first
    while len(active_zone) > MAX_ACTIVE_CHARS:
        # Find last history bullet
        last_bullet = active_zone.rfind('\n- [')
        if last_bullet == -1:
            break
        active_zone = active_zone[:last_bullet]
    
    # If still too long, trim gotchas from bottom
    while len(active_zone) > MAX_ACTIVE_CHARS:
        # Find last tag bullet
        last_tag = active_zone.rfind('\n- **[')
        if last_tag == -1:
            break
        active_zone = active_zone[:last_tag]
    
    # Build the archive content — use original full content
    if archive:
        full_archive = archive
    else:
        full_archive = source_content
    
    # Compose final file
    result = active_zone.rstrip() + "\n\n" + ARCHIVE_MARKER + full_archive
    
    if dry_run:
        active_len = len(active_zone)
        total_len = len(result)
        print(f"  {filepath.name}: {original_size} → {total_len} bytes (active: {active_len} chars)")
        if active_len > MAX_ACTIVE_CHARS:
            print(f"  ⚠️  Active zone still over {MAX_ACTIVE_CHARS}: {active_len} chars")
        return result
    
    write_file(filepath, result)
    active_len = len(active_zone)
    print(f"  ✓ {filepath.name}: {original_size:,} → {len(result):,} bytes (active: {active_len} chars)")
    
    return result

def main():
    if len(sys.argv) < 2:
        print("Usage: compact.py <file1.md> [file2.md ...]")
        print("       compact.py --all     # compact all agent memory files")
        print("       compact.py --dry-run <file1.md> [file2.md ...]")
        sys.exit(1)
    
    dry_run = '--dry-run' in sys.argv
    args = [a for a in sys.argv[1:] if a not in ('--dry-run',)]
    
    if '--all' in args:
        # Walk up from script location to find project root with .agents/
        script_dir = Path(__file__).resolve().parent
        memory_dir = None
        for parent in [Path.cwd()] + list(Path.cwd().parents):
            candidate = parent / '.agents' / 'agent-memory'
            if candidate.is_dir():
                memory_dir = candidate
                break
        if memory_dir is None:
            # Fallback: assume standard layout relative to .pi/skills/
            # .pi/skills/memory-compaction/ -> .pi/ -> project root -> .agents/agent-memory/
            candidate = script_dir.parent.parent.parent / '.agents' / 'agent-memory'
            if candidate.is_dir():
                memory_dir = candidate
            else:
                print(f"  ✗ Could not find .agents/agent-memory/ directory")
                sys.exit(1)
        files = sorted(memory_dir.glob('*.md'))
        print(f"Compacting {len(files)} memory files...\n")
        for f in files:
            try:
                compact_file(f, dry_run=dry_run)
            except Exception as e:
                print(f"  ✗ {f.name}: {e}")
    else:
        for filepath_str in args:
            filepath = Path(filepath_str)
            if not filepath.exists():
                print(f"  ✗ {filepath}: not found")
                continue
            try:
                compact_file(filepath, dry_run=dry_run)
            except Exception as e:
                print(f"  ✗ {filepath}: {e}")

if __name__ == '__main__':
    main()
