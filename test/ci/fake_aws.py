#!/usr/bin/env python3
"""A stand-in for the AWS CLI for script tests: S3 as a directory tree, CloudFront invalidations as log lines.

Implements only what scripts/ci/*.sh call: `s3 cp`, `s3 ls [--recursive]`, `s3 rm [--recursive]` and
`cloudfront create-invalidation`. Environment:
  FAKE_S3_ROOT         directory that holds one folder per bucket (required)
  FAKE_ALLOW_PREFIX    if set, writes and deletes are refused outside keys that start with it
  FAKE_DENY_PREFIX     if set, writes and deletes are refused for keys that start with it
  FAKE_CORRUPT_UPLOAD  if set, every upload stores one flipped byte (a damaged transfer)
Every call is appended to $FAKE_S3_ROOT/.calls.log, one JSON line each; metadata of uploads is kept in .meta/.
"""
import json
import os
import sys

ROOT = os.environ['FAKE_S3_ROOT']
VALUE_OPTS = {'--content-type', '--cache-control', '--query', '--output', '--distribution-id'}


def log(entry):
    with open(os.path.join(ROOT, '.calls.log'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(entry) + '\n')


def split_s3(uri):
    assert uri.startswith('s3://'), uri
    bucket, _, key = uri[5:].partition('/')
    return bucket, key


def check_write(key):
    allow, deny = os.environ.get('FAKE_ALLOW_PREFIX'), os.environ.get('FAKE_DENY_PREFIX')
    if (allow and not key.startswith(allow)) or (deny and key.startswith(deny)):
        print('An error occurred (AccessDenied) when calling the PutObject operation: key %s' % key, file=sys.stderr)
        sys.exit(1)


def parse(args):
    pos, opts, i = [], {}, 0
    while i < len(args):
        a = args[i]
        if a == '--paths':
            opts['--paths'] = []
            i += 1
            while i < len(args) and not args[i].startswith('--'):
                opts['--paths'].append(args[i])
                i += 1
            continue
        if a in VALUE_OPTS:
            opts[a] = args[i + 1]
            i += 2
            continue
        if a.startswith('--'):
            opts[a] = True
        else:
            pos.append(a)
        i += 1
    return pos, opts


def path_of(bucket, key):
    return os.path.join(ROOT, bucket, key)


def all_keys(bucket):
    base = os.path.join(ROOT, bucket)
    out = []
    for dirpath, _, names in os.walk(base):
        for n in names:
            out.append(os.path.relpath(os.path.join(dirpath, n), base))
    return sorted(out)


def s3_cp(pos, opts):
    src, dst = pos
    if dst.startswith('s3://'):
        bucket, key = split_s3(dst)
        check_write(key)
        with open(src, 'rb') as f:
            data = bytearray(f.read())
        if os.environ.get('FAKE_CORRUPT_UPLOAD') and data:
            data[len(data) // 2] ^= 1
        p = path_of(bucket, key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(data)
        meta = os.path.join(ROOT, '.meta', bucket, key + '.json')
        os.makedirs(os.path.dirname(meta), exist_ok=True)
        with open(meta, 'w', encoding='utf-8') as f:
            json.dump({'content-type': opts.get('--content-type'), 'cache-control': opts.get('--cache-control')}, f)
        log({'op': 'put', 'bucket': bucket, 'key': key})
    else:
        bucket, key = split_s3(src)
        p = path_of(bucket, key)
        if not os.path.isfile(p):
            print('fatal error: An error occurred (404) when calling the HeadObject operation: Key "%s" does not exist' % key, file=sys.stderr)
            sys.exit(1)
        with open(p, 'rb') as f, open(dst, 'wb') as g:
            g.write(f.read())
        log({'op': 'get', 'bucket': bucket, 'key': key})


def s3_ls(pos, opts):
    bucket, prefix = split_s3(pos[0])
    keys = [k for k in all_keys(bucket) if k.startswith(prefix)]
    if '--recursive' in opts:
        for k in keys:
            print('2026-11-01 04:00:00 %10d %s' % (os.path.getsize(path_of(bucket, k)), k))
        return
    seen = set()
    for k in keys:
        rest = k[len(prefix):]
        if '/' in rest:
            d = rest.split('/')[0] + '/'
            if d not in seen:
                seen.add(d)
                print('%sPRE %s' % (' ' * 27, d))
        else:
            print('2026-11-01 04:00:00 %10d %s' % (os.path.getsize(path_of(bucket, k)), rest))


def s3_rm(pos, opts):
    bucket, key = split_s3(pos[0])
    targets = [k for k in all_keys(bucket) if k.startswith(key)] if '--recursive' in opts else [key]
    for k in targets:
        check_write(k)
        p = path_of(bucket, k)
        if os.path.isfile(p):
            os.remove(p)
            log({'op': 'delete', 'bucket': bucket, 'key': k})


def main():
    args = sys.argv[1:]
    service, command, rest = args[0], args[1], args[2:]
    pos, opts = parse(rest)
    if (service, command) == ('s3', 'cp'):
        s3_cp(pos, opts)
    elif (service, command) == ('s3', 'ls'):
        s3_ls(pos, opts)
    elif (service, command) == ('s3', 'rm'):
        s3_rm(pos, opts)
    elif (service, command) == ('cloudfront', 'create-invalidation'):
        log({'op': 'invalidate', 'distribution': opts['--distribution-id'], 'paths': opts['--paths']})
        print('INVALIDATION1')
    else:
        print('fake aws: unsupported %s %s' % (service, command), file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
