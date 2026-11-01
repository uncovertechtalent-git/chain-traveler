"""Tests of scripts/fetch-delays.sh with a fake curl that serves local files: what it asks for, what it writes, and its exit status."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from test_realtime import entity, feed, stop, trip, write_map, IDS  # noqa: E402

SITE = 'https://site.test'
STREAM = 'https://realtime.gtfs.de/realtime-free.pb'

# A curl that answers from files named in $FAKE_CURL_MAP (url -> path) and logs every call; a url not in the map is a 404.
FAKE_CURL = r'''#!/usr/bin/env python3
import json, os, shutil, sys
args = sys.argv[1:]
url, out = args[-1], args[args.index('-o') + 1]
with open(os.environ['FAKE_CURL_LOG'], 'a') as f:
    f.write(json.dumps(args) + '\n')
src = json.load(open(os.environ['FAKE_CURL_MAP'])).get(url)
if src is None:
    print('curl: (22) The requested URL returned error: 404', file=sys.stderr)
    sys.exit(22)
shutil.copyfile(src, out)
'''


class FetchDelaysTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        bindir = os.path.join(self.tmp, 'bin')
        os.makedirs(bindir)
        shim = os.path.join(bindir, 'curl')
        with open(shim, 'w') as f:
            f.write(FAKE_CURL)
        os.chmod(shim, os.stat(shim).st_mode | stat.S_IXUSR)
        self.log = os.path.join(self.tmp, 'curl.log')
        self.urls = {}
        self.map = os.path.join(self.tmp, 'map.json')
        self.env = dict(os.environ, PATH=bindir + os.pathsep + os.environ['PATH'], FAKE_CURL_LOG=self.log, FAKE_CURL_MAP=self.map)
        self.mapdir = os.path.join(self.tmp, 'served')
        self.manifest = write_map(self.mapdir, IDS)
        self.serve(SITE + '/data/latest.json', os.path.join(self.mapdir, 'latest.json'))
        self.serve(SITE + '/data/2026-11-01/trip-ids.txt.gz', os.path.join(self.mapdir, 'trip-ids.txt.gz'))
        self.serve_stream(feed([entity(1, trip('t3', stops=[stop(3, dep=(120, int(time.time()) - 10))]))], at=int(time.time()) - 10))
        self.site = os.path.join(self.tmp, 'site')

    def serve(self, url, path):
        self.urls[url] = path
        with open(self.map, 'w') as f:
            json.dump(self.urls, f)

    def serve_stream(self, data):
        p = os.path.join(self.tmp, 'stream.pb')
        with open(p, 'wb') as f:
            f.write(data)
        self.serve(STREAM, p)

    def drop(self, url):
        del self.urls[url]
        with open(self.map, 'w') as f:
            json.dump(self.urls, f)

    def run_script(self):
        return subprocess.run([os.path.join(ROOT, 'scripts', 'fetch-delays.sh'), SITE, os.path.join(self.tmp, 'work'), self.site],
                              capture_output=True, text=True, env=self.env, cwd=self.tmp)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as f:
            return [json.loads(line) for line in f]

    def written(self):
        p = os.path.join(self.site, 'data', 'delays.json')
        if not os.path.exists(p):
            return None
        with open(p, encoding='utf-8') as f:
            return json.load(f)

    def test_it_reads_the_stream_the_manifest_and_the_trip_ids_and_writes_delays_json(self):
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([c[-1] for c in self.calls()], [STREAM, SITE + '/data/latest.json', SITE + '/data/2026-11-01/trip-ids.txt.gz'])
        d = self.written()
        self.assertEqual(d['trips'], {'2026-11-01': {'delay': {'3': 2}, 'cancelled': [], 'skipped': {}}})
        self.assertEqual(d['timetable'], {'date': '2026-11-01', 'sha256': 'ab' * 32})

    def test_every_download_is_https_only_compressed_and_size_limited(self):
        self.run_script()
        for c in self.calls():
            self.assertIn('--compressed', c)
            self.assertEqual(c[c.index('--proto') + 1], '=https')
            self.assertEqual(c[c.index('--proto-redir') + 1], '=https')
            self.assertIn('--fail', c)
            self.assertLessEqual(int(c[c.index('--max-filesize') + 1]), 64 * 1024 * 1024)

    def test_a_stream_that_cannot_be_downloaded_is_nothing_to_publish(self):
        self.drop(STREAM)
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (3, None))
        self.assertIn('nothing to publish: the stream could not be downloaded', r.stdout)

    def test_a_manifest_that_cannot_be_downloaded_is_nothing_to_publish(self):
        self.drop(SITE + '/data/latest.json')
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (3, None))
        self.assertIn('manifest', r.stdout)

    def test_a_build_without_trip_ids_asks_for_none_and_publishes_nothing(self):
        m = dict(self.manifest)
        del m['tripIdsSha256'], m['tripIdsBytes']
        p = os.path.join(self.tmp, 'old-latest.json')
        with open(p, 'w') as f:
            json.dump(m, f)
        self.serve(SITE + '/data/latest.json', p)
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (3, None))
        self.assertNotIn(SITE + '/data/2026-11-01/trip-ids.txt.gz', [c[-1] for c in self.calls()])
        self.assertIn('no trip id file', r.stdout)

    def test_a_manifest_that_names_a_file_the_site_does_not_serve_is_an_error(self):
        self.drop(SITE + '/data/2026-11-01/trip-ids.txt.gz')
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (1, None))
        self.assertIn('does not serve it', r.stderr)

    def test_a_manifest_date_that_is_not_a_date_never_reaches_a_url(self):
        m = dict(self.manifest, date='../../x')
        p = os.path.join(self.tmp, 'bad-latest.json')
        with open(p, 'w') as f:
            json.dump(m, f)
        self.serve(SITE + '/data/latest.json', p)
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (1, None))
        self.assertEqual(len(self.calls()), 2)

    def test_a_stale_stream_is_nothing_to_publish(self):
        self.serve_stream(feed([entity(1, trip('t3', stops=[stop(3, dep=(120, 1000))]))], at=int(time.time()) - 3600))
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (3, None))
        self.assertIn('minutes old', r.stdout)

    def test_a_page_served_instead_of_the_stream_is_nothing_to_publish(self):
        self.serve_stream(b'<html>maintenance</html>')
        r = self.run_script()
        self.assertEqual((r.returncode, self.written()), (3, None))

    def test_a_run_with_nothing_to_publish_leaves_the_file_of_the_last_good_run_alone(self):
        self.assertEqual(self.run_script().returncode, 0)
        good = self.written()
        self.drop(STREAM)
        self.assertEqual(self.run_script().returncode, 3)
        self.assertEqual(self.written(), good)


if __name__ == '__main__':
    unittest.main()
