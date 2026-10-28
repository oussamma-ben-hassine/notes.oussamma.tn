#!/usr/bin/env python3
"""Archive a stopped NoteVault store as per-owner Markdown and complete JSON.

This is an offline export, not a BookStack importer. No network or API calls.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path


def export(source: Path, destination: Path):
    raw = source.read_bytes()
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get('users'), dict):
        raise ValueError('Expected a NoteVault object with a users mapping')
    for owner, space in data['users'].items():
        if not isinstance(space, dict) or not isinstance(space.get('notes', []), list):
            raise ValueError('Invalid user space')
        for note in space.get('notes', []):
            if not isinstance(note, dict) or not isinstance(note.get('content', ''), str):
                raise ValueError('Invalid note content')
            if not isinstance(note.get('checklist', []), list):
                raise ValueError('Invalid checklist')
    # Refuse an existing destination, including symlinks; never overwrite archives.
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    backup = destination / 'notes_store.json'
    with backup.open('xb') as stream:
        stream.write(raw)
    os.chmod(backup, 0o600)
    manifest = {'source_sha256': hashlib.sha256(raw).hexdigest(), 'users': []}
    count = 0
    for owner, space in data['users'].items():
        owner_dir = destination / ('user-' + hashlib.sha256(owner.encode()).hexdigest())
        owner_dir.mkdir(mode=0o700)
        entries = []
        for index, note in enumerate(space.get('notes', []), start=1):
            # Filenames never contain user-controlled paths or titles.
            filename = f'note-{index:06d}.md'
            title = str(note.get('title') or 'Sans titre').replace('\n', ' ')
            text = '# ' + title + '\n\n' + note.get('content', '')
            checklist = note.get('checklist', [])
            if checklist:
                text += '\n\n## Checklist\n\n'
                for item in checklist:
                    if isinstance(item, dict):
                        mark = 'x' if item.get('done') else ' '
                        text += f"- [{mark}] {item.get('text', '')}\n"
            target = owner_dir / filename
            target.write_text(text + '\n', encoding='utf-8')
            os.chmod(target, 0o600)
            entries.append({'file': filename, 'original_id': note.get('id'),
                            'folder_id': note.get('folderId'),
                            'archived': note.get('archived', False)})
            count += 1
        manifest['users'].append({'original_owner': owner, 'directory': owner_dir.name,
                                  'notes': entries})
    manifest_path = destination / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    os.chmod(manifest_path, 0o600)
    if backup.read_bytes() != raw:
        raise RuntimeError('Archive verification failed')
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Copied notes_store.json from a stopped instance')
    parser.add_argument('destination', type=Path, help='New directory inside an existing private backup directory')
    args = parser.parse_args()
    print(f'Exported {export(args.source, args.destination)} notes; archive includes the complete original JSON.')
