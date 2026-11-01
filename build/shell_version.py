#!/usr/bin/env python3
"""Version stamp of the app shell. Standard library only.

The service worker names its cache after a hash of the shell files, so a release is one cache and an offline
shell is never a mix of two releases. The hash covers every file the deploy publishes except sw.js itself and
data/: names and sha256 of the contents, in sorted order.

Usage:
  shell_version.py version <app-dir>              print the 12-hex version
  shell_version.py stamp <app-dir> <out-sw.js>    write sw.js with the placeholder replaced by the version
"""
import hashlib
import os
import sys

PLACEHOLDER = '__SHELL_VERSION__'


def shell_files(app_dir):
    out = []
    for dirpath, _, names in os.walk(app_dir):
        for n in names:
            rel = os.path.relpath(os.path.join(dirpath, n), app_dir).replace(os.sep, '/')
            if rel == 'sw.js' or rel.startswith('data/') or n == '.DS_Store':
                continue
            out.append(rel)
    return sorted(out)


def version(app_dir):
    h = hashlib.sha256()
    for rel in shell_files(app_dir):
        with open(os.path.join(app_dir, rel), 'rb') as f:
            h.update(('%s %s\n' % (rel, hashlib.sha256(f.read()).hexdigest())).encode())
    return h.hexdigest()[:12]


def stamp(app_dir, out_path):
    with open(os.path.join(app_dir, 'sw.js'), encoding='utf-8') as f:
        src = f.read()
    if src.count(PLACEHOLDER) != 1:
        raise ValueError('sw.js must contain %s exactly once' % PLACEHOLDER)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(src.replace(PLACEHOLDER, version(app_dir)))


def main(argv):
    try:
        if len(argv) == 3 and argv[1] == 'version':
            print(version(argv[2]))
        elif len(argv) == 4 and argv[1] == 'stamp':
            stamp(argv[2], argv[3])
        else:
            raise SystemExit(__doc__)
    except (ValueError, OSError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
