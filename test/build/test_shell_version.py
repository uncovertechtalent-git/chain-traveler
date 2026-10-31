"""Tests of build/shell_version.py."""
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'build'))
import shell_version  # noqa: E402


class ShellVersionTest(unittest.TestCase):
    def setUp(self):
        self.app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.app)
        self.write('sw.js', "const VERSION = '__SHELL_VERSION__';")
        self.write('app.js', 'a')

    def write(self, rel, text):
        p = os.path.join(self.app, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as f:
            f.write(text)

    def test_the_version_ignores_sw_js_and_data(self):
        v = shell_version.version(self.app)
        self.write('sw.js', "const VERSION = '__SHELL_VERSION__'; // edited")
        self.write('data/latest.json', '{}')
        self.assertEqual(shell_version.version(self.app), v)

    def test_the_version_follows_the_shell_files(self):
        v = shell_version.version(self.app)
        self.write('app.js', 'b')
        self.assertNotEqual(shell_version.version(self.app), v)
        self.write('app.js', 'a')
        self.assertEqual(shell_version.version(self.app), v)
        self.write('extra.css', 'x{}')
        self.assertNotEqual(shell_version.version(self.app), v)

    def test_a_renamed_file_changes_the_version(self):
        self.write('b.js', 'same')
        v = shell_version.version(self.app)
        os.rename(os.path.join(self.app, 'b.js'), os.path.join(self.app, 'c.js'))
        self.assertNotEqual(shell_version.version(self.app), v)

    def test_stamp_needs_exactly_one_placeholder(self):
        outdir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outdir)
        out = os.path.join(outdir, 'out.js')
        shell_version.stamp(self.app, out)
        with open(out) as f:
            self.assertIn(shell_version.version(self.app), f.read())
        self.write('sw.js', 'no placeholder')
        with self.assertRaises(ValueError):
            shell_version.stamp(self.app, out)
        self.write('sw.js', "'__SHELL_VERSION__' '__SHELL_VERSION__'")
        with self.assertRaises(ValueError):
            shell_version.stamp(self.app, out)


if __name__ == '__main__':
    unittest.main()
