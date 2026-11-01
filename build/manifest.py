#!/usr/bin/env python3
"""Manifest and retention for the published timetable builds. Standard library only.

A build is two files, timetable.bin.gz and meta.json, published under data/<date>/ and never changed
afterwards. data/latest.json points the app at the newest build and carries what it needs to verify the
download before use:

  {"format": 1, "date": "2026-10-31", "sha256": "<timetable.bin.gz>", "bytes": 5231112,
   "metaSha256": "<meta.json>", "metaBytes": 269000, "firstDate": "2026-10-31", "nDays": 31,
   "built": "2026-10-31T16:46:18Z", "feedSha256": "<the gtfs.de zip>"}

Usage:
  manifest.py make <built-dir> <out-dir> [--date YYYY-MM-DD]   write <out-dir>/data/<date>/ and <out-dir>/data/latest.json
  manifest.py check <build-dir> <latest.json>                  verify a build directory against a manifest
  manifest.py prune <keep> <date> [<date> ...]                 print the dates to delete, oldest first, keeping the newest <keep>
"""
import hashlib
import json
import os
import re
import shutil
import sys

FORMAT = 1
BUILD_FILES = ('timetable.bin.gz', 'meta.json')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
MAGIC = b'CHT1'


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def make_manifest(build_dir, date=None):
    """Manifest for the build in build_dir (the output of build_timetable.py)."""
    bin_path = os.path.join(build_dir, 'timetable.bin.gz')
    meta_path = os.path.join(build_dir, 'meta.json')
    with open(meta_path, encoding='utf-8') as f:
        meta = json.load(f)
    built = meta['feed']['built']
    date = date or built[:10]
    if not DATE_RE.match(date):
        raise ValueError('date must be YYYY-MM-DD: %r' % date)
    feed_sha = meta['feed'].get('sha256')
    if not feed_sha or not SHA_RE.match(feed_sha):
        raise ValueError('meta.json carries no feed sha256; run the build with the feed zip beside the feed directory')
    return {
        'format': FORMAT,
        'date': date,
        'sha256': sha256_file(bin_path),
        'bytes': os.path.getsize(bin_path),
        'metaSha256': sha256_file(meta_path),
        'metaBytes': os.path.getsize(meta_path),
        'firstDate': meta['firstDate'],
        'nDays': meta['nDays'],
        'built': built,
        'feedSha256': feed_sha,
    }


def validate_manifest(m):
    """Raise ValueError unless m is a well-formed manifest. The same rules the browser applies."""
    if not isinstance(m, dict) or m.get('format') != FORMAT:
        raise ValueError('unsupported manifest format')
    for k in ('sha256', 'metaSha256', 'feedSha256'):
        if not isinstance(m.get(k), str) or not SHA_RE.match(m[k]):
            raise ValueError('%s must be a lowercase hex sha256' % k)
    for k in ('date', 'firstDate'):
        if not isinstance(m.get(k), str) or not DATE_RE.match(m[k]):
            raise ValueError('%s must be YYYY-MM-DD' % k)
    for k in ('bytes', 'metaBytes', 'nDays'):
        if not isinstance(m.get(k), int) or isinstance(m.get(k), bool) or m[k] <= 0:
            raise ValueError('%s must be a positive integer' % k)
    if not isinstance(m.get('built'), str):
        raise ValueError('built must be a timestamp string')


def check_build(build_dir, manifest):
    """Raise ValueError unless the files in build_dir match the manifest byte for byte."""
    validate_manifest(manifest)
    for name, sha_key, size_key in (('timetable.bin.gz', 'sha256', 'bytes'), ('meta.json', 'metaSha256', 'metaBytes')):
        path = os.path.join(build_dir, name)
        if not os.path.isfile(path):
            raise ValueError('%s is missing' % name)
        if os.path.getsize(path) != manifest[size_key]:
            raise ValueError('%s: size %d, manifest says %d' % (name, os.path.getsize(path), manifest[size_key]))
        if sha256_file(path) != manifest[sha_key]:
            raise ValueError('%s: sha256 does not match the manifest' % name)
    with open(os.path.join(build_dir, 'timetable.bin.gz'), 'rb') as f:
        head = f.read(2)
    if head != b'\x1f\x8b':
        raise ValueError('timetable.bin.gz is not gzip')


def prune(dates, keep):
    """Dates to delete so that the newest `keep` remain. Oldest first. Names that are not dates are never listed."""
    if keep < 1:
        raise ValueError('keep at least one build')
    valid = sorted({d for d in dates if DATE_RE.match(d)})
    return valid[:-keep] if len(valid) > keep else []


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'))
        f.write('\n')


def cmd_make(args):
    if len(args) < 2:
        raise SystemExit(__doc__)
    build_dir, out_dir, date = args[0], args[1], None
    if len(args) == 4 and args[2] == '--date':
        date = args[3]
    elif len(args) != 2:
        raise SystemExit(__doc__)
    m = make_manifest(build_dir, date)
    target = os.path.join(out_dir, 'data', m['date'])
    os.makedirs(target, exist_ok=True)
    for name in BUILD_FILES:
        shutil.copyfile(os.path.join(build_dir, name), os.path.join(target, name))
    check_build(target, m)
    write_json(os.path.join(out_dir, 'data', 'latest.json'), m)
    print(json.dumps(m, indent=1))


def cmd_check(args):
    if len(args) != 2:
        raise SystemExit(__doc__)
    with open(args[1], encoding='utf-8') as f:
        check_build(args[0], json.load(f))
    print('ok')


def cmd_prune(args):
    if len(args) < 1:
        raise SystemExit(__doc__)
    for d in prune(args[1:], int(args[0])):
        print(d)


def main(argv):
    if len(argv) < 2 or argv[1] not in ('make', 'check', 'prune'):
        raise SystemExit(__doc__)
    try:
        {'make': cmd_make, 'check': cmd_check, 'prune': cmd_prune}[argv[1]](argv[2:])
    except (ValueError, KeyError, OSError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
