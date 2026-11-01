"""Tests of build/manifest.py: the manifest, the check before publishing, and retention. Standard library only."""
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'build'))
import manifest  # noqa: E402

FEED_SHA = 'ab' * 32


def write_build(d, payload=b'CHT1' + b'\0' * 28, built='2026-10-31T16:46:18Z', feed_sha=FEED_SHA, stations=None):
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'timetable.bin.gz'), 'wb') as f:
        f.write(gzip.compress(payload, 9, mtime=0))
    meta = {'format': 1, 'firstDate': '2026-10-31', 'nDays': 31, 'feed': {'built': built, 'sha256': feed_sha}}
    if stations is not None:
        meta['stations'] = stations
    with open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f)


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.build = os.path.join(self.tmp, 'build')
        write_build(self.build)

    def test_manifest_describes_both_files(self):
        m = manifest.make_manifest(self.build)
        with open(os.path.join(self.build, 'timetable.bin.gz'), 'rb') as f:
            raw = f.read()
        self.assertEqual(m['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(m['bytes'], len(raw))
        self.assertEqual(m['date'], '2026-10-31')
        self.assertEqual((m['firstDate'], m['nDays'], m['feedSha256']), ('2026-10-31', 31, FEED_SHA))
        manifest.validate_manifest(m)

    def test_same_feed_gives_the_same_bytes(self):
        other = os.path.join(self.tmp, 'other')
        write_build(other)
        self.assertEqual(manifest.make_manifest(self.build)['sha256'], manifest.make_manifest(other)['sha256'])

    def test_date_defaults_to_the_build_day_and_can_be_set(self):
        self.assertEqual(manifest.make_manifest(self.build, '2026-11-02')['date'], '2026-11-02')
        with self.assertRaises(ValueError):
            manifest.make_manifest(self.build, '2026-11-2')
        with self.assertRaises(ValueError):
            manifest.make_manifest(self.build, '../etc')

    def test_a_build_without_the_feed_hash_is_refused(self):
        write_build(self.build, feed_sha=None)
        with self.assertRaises(ValueError):
            manifest.make_manifest(self.build)

    def test_check_accepts_the_build_it_describes(self):
        manifest.check_build(self.build, manifest.make_manifest(self.build))

    def test_check_refuses_a_changed_byte(self):
        m = manifest.make_manifest(self.build)
        path = os.path.join(self.build, 'timetable.bin.gz')
        with open(path, 'rb') as f:
            data = bytearray(f.read())
        data[len(data) // 2] ^= 1
        with open(path, 'wb') as f:
            f.write(data)
        with self.assertRaisesRegex(ValueError, 'sha256'):
            manifest.check_build(self.build, m)

    def test_check_refuses_a_truncated_file(self):
        m = manifest.make_manifest(self.build)
        path = os.path.join(self.build, 'meta.json')
        with open(path, 'r+b') as f:
            f.truncate(10)
        with self.assertRaisesRegex(ValueError, 'size'):
            manifest.check_build(self.build, m)

    def test_check_refuses_a_missing_file(self):
        m = manifest.make_manifest(self.build)
        os.remove(os.path.join(self.build, 'meta.json'))
        with self.assertRaisesRegex(ValueError, 'missing'):
            manifest.check_build(self.build, m)

    def test_validate_refuses_malformed_manifests(self):
        good = manifest.make_manifest(self.build)
        for key, bad in (('format', 2), ('sha256', 'XYZ'), ('date', '31.10.2026'), ('bytes', 0), ('bytes', True), ('nDays', -1), ('built', 5)):
            m = dict(good, **{key: bad})
            with self.assertRaises(ValueError, msg=key):
                manifest.validate_manifest(m)
        with self.assertRaises(ValueError):
            manifest.validate_manifest([])

    def test_prune_keeps_the_newest_three(self):
        dates = ['2026-10-29', '2026-10-31', '2026-10-30', '2026-11-01', '2026-10-28']
        self.assertEqual(manifest.prune(dates, 3), ['2026-10-28', '2026-10-29'])
        self.assertEqual(manifest.prune(dates[:3], 3), [])
        self.assertEqual(manifest.prune([], 3), [])

    def test_prune_never_lists_names_that_are_not_dates(self):
        self.assertEqual(manifest.prune(['latest.json', 'tmp', '2026-10-01', '2026-10-02'], 1), ['2026-10-01'])

    def test_prune_refuses_to_keep_nothing(self):
        with self.assertRaises(ValueError):
            manifest.prune(['2026-10-01'], 0)

    def test_make_writes_an_immutable_path_and_the_pointer(self):
        out = os.path.join(self.tmp, 'out')
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'manifest.py'), 'make', self.build, out],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, 'data', 'latest.json'), encoding='utf-8') as f:
            m = json.load(f)
        self.assertEqual(sorted(os.listdir(os.path.join(out, 'data'))), ['2026-10-31', 'latest.json'])
        manifest.check_build(os.path.join(out, 'data', m['date']), m)

    def test_cli_exit_code_is_nonzero_on_a_bad_build(self):
        out = os.path.join(self.tmp, 'out')
        os.remove(os.path.join(self.build, 'meta.json'))
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'manifest.py'), 'make', self.build, out],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn('error:', r.stderr)


class FeedDateTest(unittest.TestCase):
    """A build is named by the date of its feed, not by the day it was built."""

    BLOCK = 'HTTP/2 200 \r\ncontent-type: application/zip\r\nlast-modified: Sat, 31 Oct 2026 09:38:32 GMT\r\n\r\n'

    def test_the_utc_date_of_last_modified(self):
        self.assertEqual(manifest.feed_date(self.BLOCK), '2026-10-31')

    def test_another_time_zone_is_read_in_utc(self):
        self.assertEqual(manifest.feed_date('Last-Modified: Sat, 31 Oct 2026 23:30:00 -0500\n'), '2026-11-01')
        self.assertEqual(manifest.feed_date('Last-Modified: Sun, 01 Nov 2026 00:30:00 +0200\n'), '2026-10-31')

    def test_after_a_redirect_the_last_response_counts(self):
        redirect = 'HTTP/2 302 \r\nlast-modified: Mon, 26 Oct 2026 08:00:00 GMT\r\n\r\n'
        self.assertEqual(manifest.feed_date(redirect + self.BLOCK), '2026-10-31')

    def test_no_usable_header_gives_nothing(self):
        for text in ('', 'HTTP/2 200 \r\ncontent-length: 5\r\n', 'Last-Modified: yesterday\n', 'Last-Modified: 2026-10-31\n'):
            self.assertIsNone(manifest.feed_date(text), repr(text))

    def test_two_feeds_built_on_one_day_get_two_paths(self):
        # The 2026-11-01 incident: the Oct 31 feed was published on Nov 1, then gtfs.de regenerated, and the
        # build day named both builds data/2026-11-01/.
        old = manifest.feed_date('Last-Modified: Sat, 31 Oct 2026 09:38:32 GMT\n')
        new = manifest.feed_date('Last-Modified: Sun, 01 Nov 2026 09:41:07 GMT\n')
        self.assertNotEqual(old, new)

    def test_cli_prints_the_date_or_nothing(self):
        tool = os.path.join(ROOT, 'build', 'manifest.py')
        with tempfile.TemporaryDirectory() as d:
            hdr = os.path.join(d, 'headers.txt')
            with open(hdr, 'w', encoding='utf-8') as f:
                f.write(self.BLOCK)
            r = subprocess.run([sys.executable, '-I', tool, 'feed-date', hdr], capture_output=True, text=True)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, '2026-10-31'))
            with open(hdr, 'w', encoding='utf-8') as f:
                f.write('HTTP/2 200 \r\n')
            r = subprocess.run([sys.executable, '-I', tool, 'feed-date', hdr], capture_output=True, text=True)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, ''))

    def test_fetch_feed_names_the_build_by_the_feed_date(self):
        # fetch-feed.sh downloads the real feed, so it is not run here; this guards the wiring.
        with open(os.path.join(ROOT, 'scripts', 'fetch-feed.sh'), encoding='utf-8') as f:
            script = f.read()
        self.assertIn('manifest.py" feed-date "$WORK/headers.txt"', script)
        self.assertIn('--date "$FEED_DATE"', script)


if __name__ == '__main__':
    unittest.main()
