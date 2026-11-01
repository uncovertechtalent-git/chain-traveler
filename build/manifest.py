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
  manifest.py feed-date <headers.txt>                          print the UTC date of the feed's Last-Modified header (nothing if there is none)
  manifest.py check <build-dir> <latest.json>                  verify a build directory against a manifest
  manifest.py kid-of <base64-spki>                             print the key id (8 hex) of a public key
  manifest.py set-kid <latest.json> <kid>                      put the key id into the manifest (before it is signed)
  manifest.py canonical <latest.json>                          write the bytes that are signed to stdout
  manifest.py attach-sig <latest.json> <base64-der-signature>  put the signature (raw r|s, base64) into the manifest
  manifest.py verify-sig <latest.json> <base64-spki>           check the signature as shipped against the public key with openssl
  manifest.py prune <keep> <date> [<date> ...]                 print the dates to delete, oldest first, keeping the newest <keep>
"""
import base64
import datetime
import email.utils
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

FORMAT = 1
BUILD_FILES = ('timetable.bin.gz', 'meta.json')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
KID_RE = re.compile(r'^[0-9a-f]{8}$')
MAGIC = b'CHT1'
P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551   # n: r and s of an ECDSA P-256 signature are in 1..n-1


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
    if 'kid' in m and (not isinstance(m['kid'], str) or not KID_RE.match(m['kid'])):
        raise ValueError('kid must be 8 lowercase hex characters')
    if 'sig' in m:
        try:
            ok = isinstance(m['sig'], str) and len(base64.b64decode(m['sig'], validate=True)) == 64
        except ValueError:
            ok = False
        if not ok:
            raise ValueError('sig must be base64 of a 64-byte ECDSA P-256 signature (r|s)')


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


def feed_date(headers_text):
    """The UTC date (YYYY-MM-DD) of the last Last-Modified header in `headers_text`, or None.

    A build is named by the date of the feed it was built from, not by the day it was built: gtfs.de regenerates the
    feed around 09:40 UTC, so two different feeds can be built on one calendar day and must not share a dated path.
    With redirects curl writes one header block per response; the last one is the file's own."""
    found = None
    for line in headers_text.splitlines():
        name, _, value = line.partition(':')
        if name.strip().lower() == 'last-modified':
            try:
                dt = email.utils.parsedate_to_datetime(value.strip())
            except (TypeError, ValueError):
                continue
            if dt.tzinfo is None:
                continue
            found = dt.astimezone(datetime.timezone.utc).strftime('%Y-%m-%d')
    return found


# ---- signature
#
# The manifest may carry a signature so that an app that holds the public key accepts a timetable only from whoever can
# use the private key (an AWS KMS key that only the data role may use), not from whoever can write the bucket. The
# signed bytes are the manifest without `sig`, keys sorted, no spaces: every field is ASCII text or an integer, so
# the browser's JSON.stringify of the same object gives the same bytes (a test holds both to one golden manifest).
# ECDSA P-256 with SHA-256; KMS returns the signature as DER, the browser's WebCrypto takes r|s (64 bytes).

def canonical(manifest):
    """The bytes that are signed."""
    body = {k: v for k, v in manifest.items() if k != 'sig'}
    return json.dumps(body, sort_keys=True, separators=(',', ':')).encode('ascii')


def der_to_raw(der):
    """An ECDSA signature as DER (SEQUENCE of two INTEGERs) to r|s, 32 bytes each."""
    def read_len(b, i):
        n = b[i]
        if n < 0x80:
            return n, i + 1
        k = n & 0x7f
        return int.from_bytes(b[i + 1:i + 1 + k], 'big'), i + 1 + k

    def read_int(b, i):
        if b[i] != 0x02:
            raise ValueError('not a DER signature')
        n, i = read_len(b, i + 1)
        v = int.from_bytes(b[i:i + n], 'big')
        return v, i + n

    if len(der) < 8 or der[0] != 0x30:
        raise ValueError('not a DER signature')
    n, i = read_len(der, 1)
    if i + n != len(der):
        raise ValueError('not a DER signature')
    r, i = read_int(der, i)
    s, i = read_int(der, i)
    if i != len(der) or not (0 < r < P256_ORDER and 0 < s < P256_ORDER):
        raise ValueError('not a P-256 signature')
    return r.to_bytes(32, 'big') + s.to_bytes(32, 'big')


def raw_to_der(raw):
    """r|s (64 bytes) back to DER, the form openssl checks. Written from the DER rules on its own, not as the inverse of
    der_to_raw, so that publish-data.sh can check the shipped form with something other than the conversion that made it."""
    if len(raw) != 64:
        raise ValueError('the signature is not 64 bytes')

    def der_int(b):
        b = b.lstrip(b'\0') or b'\0'
        if b[0] & 0x80:
            b = b'\0' + b
        return b'\x02' + bytes([len(b)]) + b

    body = der_int(raw[:32]) + der_int(raw[32:])
    return b'\x30' + bytes([len(body)]) + body


def spki_to_pem(spki_der):
    b64 = base64.b64encode(spki_der).decode('ascii')
    return '-----BEGIN PUBLIC KEY-----\n' + '\n'.join(b64[i:i + 64] for i in range(0, len(b64), 64)) + '\n-----END PUBLIC KEY-----\n'


def verify_sig(manifest, spki_der):
    """True when the signature in the manifest, as it ships (base64 of r|s), is a valid ECDSA P-256 signature over
    canonical(manifest) by the public key (SubjectPublicKeyInfo, DER), checked with the openssl CLI. A manifest that is not
    signed, a signature of the wrong length and a key id that does not name this key are errors, not False."""
    if 'sig' not in manifest or 'kid' not in manifest:
        raise ValueError('the manifest is not signed')
    raw = base64.b64decode(manifest['sig'], validate=True)
    if manifest['kid'] != key_id(spki_der):
        raise ValueError('the key id of the manifest does not name this public key')
    with tempfile.TemporaryDirectory() as d:
        files = {'pub.pem': spki_to_pem(spki_der).encode('ascii'), 'sig.der': raw_to_der(raw), 'msg': canonical(manifest)}
        for name, data in files.items():
            with open(os.path.join(d, name), 'wb') as f:
                f.write(data)
        r = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', os.path.join(d, 'pub.pem'), '-signature', os.path.join(d, 'sig.der'),
                            os.path.join(d, 'msg')], capture_output=True)
    return r.returncode == 0

def key_id(spki_der):
    """Short id of a public key: the first 8 hex characters of the sha256 of its SubjectPublicKeyInfo."""
    return hashlib.sha256(spki_der).hexdigest()[:8]


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


def cmd_feed_date(args):
    if len(args) != 1:
        raise SystemExit(__doc__)
    with open(args[0], encoding='utf-8', errors='replace') as f:
        d = feed_date(f.read())
    if d:
        print(d)


def _load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def cmd_kid_of(args):
    if len(args) != 1:
        raise SystemExit(__doc__)
    print(key_id(base64.b64decode(args[0], validate=True)))


def cmd_set_kid(args):
    if len(args) != 2:
        raise SystemExit(__doc__)
    m = _load(args[0])
    m['kid'] = args[1]
    m.pop('sig', None)
    validate_manifest(m)
    write_json(args[0], m)


def cmd_canonical(args):
    if len(args) != 1:
        raise SystemExit(__doc__)
    sys.stdout.buffer.write(canonical(_load(args[0])))


def cmd_attach_sig(args):
    if len(args) != 2:
        raise SystemExit(__doc__)
    m = _load(args[0])
    if 'kid' not in m:
        raise ValueError('set the key id before the signature: the signature covers it')
    m['sig'] = base64.b64encode(der_to_raw(base64.b64decode(args[1], validate=True))).decode('ascii')
    validate_manifest(m)
    write_json(args[0], m)


def cmd_verify_sig(args):
    if len(args) != 2:
        raise SystemExit(__doc__)
    if not verify_sig(_load(args[0]), base64.b64decode(args[1], validate=True)):
        raise ValueError('the signature does not verify against the public key')
    print('the signature verifies')


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
    if len(argv) < 2 or argv[1] not in ('make', 'check', 'prune', 'feed-date', 'kid-of', 'set-kid', 'canonical', 'attach-sig', 'verify-sig'):
        raise SystemExit(__doc__)
    try:
        {'make': cmd_make, 'check': cmd_check, 'prune': cmd_prune, 'feed-date': cmd_feed_date, 'kid-of': cmd_kid_of, 'set-kid': cmd_set_kid, 'canonical': cmd_canonical, 'attach-sig': cmd_attach_sig, 'verify-sig': cmd_verify_sig}[argv[1]](argv[2:])
    except (ValueError, KeyError, OSError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
