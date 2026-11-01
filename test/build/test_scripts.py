"""Tests of scripts/ci/deploy-shell.sh and scripts/ci/publish-data.sh against a fake AWS CLI (test/ci/fake_aws.py).

They prove what the scripts do and, with the allow and deny prefixes, that they stay inside the permissions of
their roles: the shell deploy never writes under data/, the data publish never writes outside it.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from test_manifest import write_build  # noqa: E402

BUCKET = 'test-bucket'
SW = "const VERSION = '__SHELL_VERSION__';\n"


class ScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        bindir = os.path.join(self.tmp, 'bin')
        os.makedirs(bindir)
        shim = os.path.join(bindir, 'aws')
        with open(shim, 'w') as f:
            f.write('#!/bin/sh\nexec "%s" "%s" "$@"\n' % (sys.executable, os.path.join(ROOT, 'test', 'ci', 'fake_aws.py')))
        os.chmod(shim, os.stat(shim).st_mode | stat.S_IXUSR)
        self.s3 = os.path.join(self.tmp, 's3')
        os.makedirs(os.path.join(self.s3, BUCKET))
        self.env = dict(os.environ, PATH=bindir + os.pathsep + os.environ['PATH'], FAKE_S3_ROOT=self.s3)
        self.env.pop('GITHUB_STEP_SUMMARY', None)

    # ---- helpers
    def run_script(self, *args, **env):
        e = dict(self.env, **env)
        return subprocess.run(args, capture_output=True, text=True, env=e, cwd=ROOT)

    def calls(self):
        p = os.path.join(self.s3, '.calls.log')
        if not os.path.exists(p):
            return []
        with open(p, encoding='utf-8') as f:
            return [json.loads(line) for line in f]

    def keys(self):
        base = os.path.join(self.s3, BUCKET)
        return sorted(os.path.relpath(os.path.join(d, n), base) for d, _, ns in os.walk(base) for n in ns)

    def meta(self, key):
        with open(os.path.join(self.s3, '.meta', BUCKET, key + '.json'), encoding='utf-8') as f:
            return json.load(f)

    def read(self, key):
        with open(os.path.join(self.s3, BUCKET, key), 'rb') as f:
            return f.read()

    def make_dist(self, name, built, feed_sha, payload=b'CHT1' + b'\0' * 28):
        build = os.path.join(self.tmp, name + '-build')
        write_build(build, payload=payload, built=built, feed_sha=feed_sha)
        out = os.path.join(self.tmp, name + '-dist')
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'manifest.py'), 'make', build, out], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return out

    def publish(self, dist, **env):
        return self.run_script(os.path.join(ROOT, 'scripts', 'ci', 'publish-data.sh'), 'publish', dist, BUCKET, **env)

    def pointer(self):
        return json.loads(self.read('data/latest.json'))

    # ---- shell deploy
    def make_app(self, files):
        app = os.path.join(self.tmp, 'app')
        shutil.rmtree(app, ignore_errors=True)
        for name, content in files.items():
            p = os.path.join(app, name)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w') as f:
                f.write(content)
        return app

    def deploy(self, app, **env):
        return self.run_script(os.path.join(ROOT, 'scripts', 'ci', 'deploy-shell.sh'), app, BUCKET, 'DIST1', **env)

    def test_shell_deploy_publishes_the_shell_and_never_touches_data(self):
        app = self.make_app({'index.html': '<!doctype html>', 'sw.js': SW, 'app.js': '//', 'style.css': 'x{}',
                             'manifest.webmanifest': '{}', 'icon.svg': '<svg/>', '.well-known/assetlinks.json': '[]',
                             'data/meta.json': '{"local":"build output must not ship"}'})
        os.makedirs(os.path.join(self.s3, BUCKET, 'data', '2026-10-31'))
        with open(os.path.join(self.s3, BUCKET, 'data', '2026-10-31', 'meta.json'), 'w') as f:
            f.write('{}')
        with open(os.path.join(self.s3, BUCKET, 'old-page.html'), 'w') as f:
            f.write('stale')
        r = self.deploy(app, FAKE_DENY_PREFIX='data/')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.keys(), ['.well-known/assetlinks.json', 'app.js', 'data/2026-10-31/meta.json', 'icon.svg', 'index.html',
                                       'manifest.webmanifest', 'style.css', 'sw.js'])
        self.assertEqual(self.read('data/2026-10-31/meta.json'), b'{}')
        for key, ctype in (('index.html', 'text/html; charset=utf-8'), ('app.js', 'text/javascript; charset=utf-8'),
                           ('manifest.webmanifest', 'application/manifest+json; charset=utf-8'),
                           ('.well-known/assetlinks.json', 'application/json; charset=utf-8'), ('icon.svg', 'image/svg+xml')):
            m = self.meta(key)
            self.assertEqual((m['content-type'], m['cache-control']), (ctype, 'no-cache'), key)
        inval = [c for c in self.calls() if c['op'] == 'invalidate'][0]
        self.assertEqual(inval['distribution'], 'DIST1')
        self.assertIn('/', inval['paths'])
        self.assertIn('/sw.js', inval['paths'])
        self.assertFalse([p for p in inval['paths'] if p.startswith('/data')])
        self.assertTrue([c for c in self.calls() if c['op'] == 'delete' and c['key'] == 'old-page.html'])

    def test_shell_deploy_stamps_the_service_worker_with_a_hash_of_the_shell(self):
        files = {'index.html': 'one', 'sw.js': SW, 'app.js': 'a'}
        self.assertEqual(self.deploy(self.make_app(files)).returncode, 0)
        first = self.read('sw.js').decode()
        self.assertNotIn('__SHELL_VERSION__', first)
        self.assertRegex(first, r"const VERSION = '[0-9a-f]{12}';")
        self.assertEqual(self.deploy(self.make_app(files)).returncode, 0)
        self.assertEqual(self.read('sw.js').decode(), first, 'the same shell gives the same version')
        self.assertEqual(self.deploy(self.make_app(dict(files, **{'app.js': 'b'}))).returncode, 0)
        self.assertNotEqual(self.read('sw.js').decode(), first, 'a changed shell file gives a new version')

    def test_shell_deploy_refuses_a_service_worker_without_the_placeholder(self):
        r = self.deploy(self.make_app({'index.html': 'x', 'sw.js': '// no placeholder'}))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual([c for c in self.calls() if c['op'] == 'put'], [])

    def test_shell_deploy_refuses_an_app_without_a_service_worker(self):
        r = self.deploy(self.make_app({'index.html': 'x'}))
        self.assertEqual(r.returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_shell_deploy_refuses_a_file_of_unknown_type(self):
        r = self.deploy(self.make_app({'index.html': 'x', 'sw.js': SW, 'notes.bin': 'x'}))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('unknown file type', r.stderr)
        self.assertEqual([c for c in self.calls() if c['op'] == 'put'], [], 'nothing is uploaded before every type is known')

    # ---- data publish
    def test_publish_writes_the_build_then_the_pointer_inside_data(self):
        dist = self.make_dist('a', '2026-10-31T09:50:00Z', 'a1' * 32)
        r = self.publish(dist, FAKE_ALLOW_PREFIX='data/')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.keys(), ['data/2026-10-31/meta.json', 'data/2026-10-31/timetable.bin.gz', 'data/latest.json'])
        puts = [c['key'] for c in self.calls() if c['op'] == 'put']
        self.assertEqual(puts[-1], 'data/latest.json', 'the pointer is written last')
        self.assertEqual(puts.count('data/latest.json'), 1)
        self.assertEqual(self.meta('data/2026-10-31/timetable.bin.gz')['cache-control'], 'public, max-age=31536000, immutable')
        self.assertEqual(self.meta('data/latest.json')['cache-control'], 'no-cache')
        self.assertEqual(self.pointer()['date'], '2026-10-31')

    def test_publish_skips_a_feed_that_is_already_published(self):
        self.assertEqual(self.publish(self.make_dist('a', '2026-10-31T09:50:00Z', 'a1' * 32)).returncode, 0)
        before = len(self.calls())
        r = self.publish(self.make_dist('b', '2026-11-01T11:20:00Z', 'a1' * 32))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('has not changed', r.stdout)
        self.assertEqual([c for c in self.calls()[before:] if c['op'] in ('put', 'delete')], [])
        self.assertEqual(self.pointer()['date'], '2026-10-31')

    def test_publish_keeps_the_newest_three_builds(self):
        for i, day in enumerate(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']):
            r = self.publish(self.make_dist(day, day + 'T09:50:00Z', '%02x' % (i + 1) * 32), FAKE_ALLOW_PREFIX='data/')
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        dates = sorted({k.split('/')[1] for k in self.keys() if k.count('/') == 2})
        self.assertEqual(dates, ['2026-10-29', '2026-10-30', '2026-10-31'])
        self.assertEqual(self.pointer()['date'], '2026-10-31')

    def test_publish_refuses_to_overwrite_a_build_with_other_bytes(self):
        self.assertEqual(self.publish(self.make_dist('a', '2026-10-31T09:50:00Z', 'a1' * 32)).returncode, 0)
        before = self.read('data/2026-10-31/timetable.bin.gz')
        other = self.make_dist('b', '2026-10-31T13:00:00Z', 'b2' * 32, payload=b'CHT1' + b'\1' * 28)
        r = self.publish(other)
        self.assertEqual(r.returncode, 1)
        self.assertIn('immutable', r.stderr)
        self.assertEqual(self.read('data/2026-10-31/timetable.bin.gz'), before)
        self.assertEqual(self.pointer()['feedSha256'], 'a1' * 32)

    def test_publish_does_not_move_the_pointer_after_a_damaged_upload(self):
        first = self.make_dist('a', '2026-10-30T09:50:00Z', 'a1' * 32)
        self.assertEqual(self.publish(first).returncode, 0)
        r = self.publish(self.make_dist('b', '2026-10-31T09:50:00Z', 'b2' * 32), FAKE_CORRUPT_UPLOAD='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.pointer()['date'], '2026-10-30', 'the app keeps the old build')

    def test_rollback_points_the_app_back_at_a_kept_build(self):
        self.assertEqual(self.publish(self.make_dist('a', '2026-10-30T09:50:00Z', 'a1' * 32)).returncode, 0)
        self.assertEqual(self.publish(self.make_dist('b', '2026-10-31T09:50:00Z', 'b2' * 32)).returncode, 0)
        r = self.run_script(os.path.join(ROOT, 'scripts', 'ci', 'publish-data.sh'), 'rollback', '2026-10-30', BUCKET, FAKE_ALLOW_PREFIX='data/')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.pointer()['date'], '2026-10-30')
        self.assertEqual(self.pointer()['feedSha256'], 'a1' * 32)
        self.assertIn('data/2026-10-31/timetable.bin.gz', self.keys(), 'rollback deletes nothing')

    def test_rollback_to_a_build_that_is_gone_fails_and_changes_nothing(self):
        self.assertEqual(self.publish(self.make_dist('a', '2026-10-31T09:50:00Z', 'a1' * 32)).returncode, 0)
        r = self.run_script(os.path.join(ROOT, 'scripts', 'ci', 'publish-data.sh'), 'rollback', '2026-10-01', BUCKET)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.pointer()['date'], '2026-10-31')

    def test_rollback_refuses_a_date_that_is_not_a_date(self):
        r = self.run_script(os.path.join(ROOT, 'scripts', 'ci', 'publish-data.sh'), 'rollback', '../x', BUCKET)
        self.assertEqual(r.returncode, 2)


if __name__ == '__main__':
    unittest.main()
