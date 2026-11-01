"""Tests of the manifest signature: the canonical form, the DER to r|s conversion, the key id, and
scripts/ci/publish-data.sh signing with a fake KMS (test/ci/fake_aws.py, ECDSA P-256 through the openssl CLI).

The signature is checked with openssl itself, independent of the code that made it: it must be a valid ECDSA P-256
signature over exactly the canonical bytes of the published manifest, by the key whose id the manifest names.
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'build'))
sys.path.insert(0, HERE)
import manifest  # noqa: E402
import test_scripts  # noqa: E402

KEY_ARN = 'arn:aws:kms:eu-central-1:111122223333:key/00000000-0000-0000-0000-000000000000'
TOOL = os.path.join(ROOT, 'build', 'manifest.py')
HAVE_OPENSSL = shutil.which('openssl') is not None


def int_der(n):
    b = n.to_bytes((n.bit_length() + 7) // 8 or 1, 'big')
    if b[0] & 0x80:
        b = b'\0' + b
    return b'\x02' + bytes([len(b)]) + b


def sig_der(r, s):
    body = int_der(r) + int_der(s)
    return b'\x30' + bytes([len(body)]) + body


def raw_to_der(raw):
    return sig_der(int.from_bytes(raw[:32], 'big'), int.from_bytes(raw[32:], 'big'))


class CanonicalTest(unittest.TestCase):
    M = {'format': 1, 'date': '2026-11-01', 'sha256': 'ab' * 32, 'bytes': 5, 'built': '2026-11-01T09:13:30Z'}

    def test_sorted_keys_no_spaces_no_signature(self):
        a = dict(self.M, sig='x')
        self.assertEqual(manifest.canonical(a), b'{"built":"2026-11-01T09:13:30Z","bytes":5,"date":"2026-11-01","format":1,"sha256":"' + b'ab' * 32 + b'"}')

    def test_the_order_of_the_fields_does_not_matter(self):
        self.assertEqual(manifest.canonical(self.M), manifest.canonical(dict(reversed(list(self.M.items())))))

    def test_the_key_id_is_part_of_what_is_signed(self):
        self.assertNotEqual(manifest.canonical(self.M), manifest.canonical(dict(self.M, kid='01234567')))

    def test_a_changed_field_changes_the_bytes(self):
        self.assertNotEqual(manifest.canonical(self.M), manifest.canonical(dict(self.M, bytes=6)))


class DerTest(unittest.TestCase):
    def test_short_integers_are_padded_to_32_bytes(self):
        raw = manifest.der_to_raw(sig_der(1, 2))
        self.assertEqual(raw, (1).to_bytes(32, 'big') + (2).to_bytes(32, 'big'))

    def test_a_leading_zero_byte_of_a_high_bit_integer_is_dropped(self):
        r, s = (1 << 255) + 5, (1 << 255) + 7
        der = sig_der(r, s)
        self.assertEqual(der.count(b'\x00\x80'), 2, 'DER pads a high bit with a zero byte')
        self.assertEqual(manifest.der_to_raw(der), r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))

    def test_the_round_trip(self):
        raw = hashlib.sha256(b'r').digest() + hashlib.sha256(b's').digest()
        self.assertEqual(manifest.der_to_raw(raw_to_der(raw)), raw)

    def test_garbage_is_refused(self):
        for bad in (b'', b'\x30', b'\x31\x06\x02\x01\x01\x02\x01\x02', sig_der(1, 2) + b'\0', sig_der(0, 2), sig_der(1, 1 << 256), b'\x30\x06\x03\x01\x01\x02\x01\x02'):
            with self.assertRaises(ValueError, msg=bad.hex()):
                manifest.der_to_raw(bad)


class KeyIdTest(unittest.TestCase):
    def test_eight_hex_characters_of_the_sha256_of_the_key(self):
        self.assertEqual(manifest.key_id(b'abc'), hashlib.sha256(b'abc').hexdigest()[:8])
        self.assertRegex(manifest.key_id(b'abc'), r'^[0-9a-f]{8}$')
        self.assertNotEqual(manifest.key_id(b'abc'), manifest.key_id(b'abd'))


class ValidateTest(unittest.TestCase):
    def good(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        test_scripts.write_build(d)
        return manifest.make_manifest(d)

    def test_a_signed_manifest_is_valid(self):
        m = dict(self.good(), kid='0123abcd', sig=base64.b64encode(b'\x01' * 64).decode())
        manifest.validate_manifest(m)

    def test_a_bad_key_id_or_signature_is_refused(self):
        for extra in ({'kid': 'XYZ'}, {'kid': '0123ABCD'}, {'kid': 5}, {'sig': 'not base64!'}, {'sig': base64.b64encode(b'\x01' * 63).decode()}, {'sig': 7}):
            with self.assertRaises(ValueError, msg=str(extra)):
                manifest.validate_manifest(dict(self.good(), **extra))


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        build = os.path.join(self.tmp, 'b')
        test_scripts.write_build(build)
        self.m = manifest.make_manifest(build)
        self.path = os.path.join(self.tmp, 'latest.json')
        manifest.write_json(self.path, self.m)

    def run_tool(self, *args):
        return subprocess.run([sys.executable, '-I', TOOL, *args], capture_output=True)

    def test_set_kid_then_canonical_then_attach_sig(self):
        self.assertEqual(self.run_tool('set-kid', self.path, '0123abcd').returncode, 0)
        canon = self.run_tool('canonical', self.path).stdout
        self.assertEqual(canon, manifest.canonical(dict(self.m, kid='0123abcd')))
        der = base64.b64encode(sig_der(3, 4)).decode()
        self.assertEqual(self.run_tool('attach-sig', self.path, der).returncode, 0)
        with open(self.path) as f:
            out = json.load(f)
        self.assertEqual(out['kid'], '0123abcd')
        self.assertEqual(base64.b64decode(out['sig']), (3).to_bytes(32, 'big') + (4).to_bytes(32, 'big'))
        self.assertEqual(self.run_tool('canonical', self.path).stdout, canon, 'the signature is not part of what is signed')

    def test_attach_sig_needs_the_key_id_first(self):
        r = self.run_tool('attach-sig', self.path, base64.b64encode(sig_der(3, 4)).decode())
        self.assertEqual(r.returncode, 1)
        self.assertIn(b'key id', r.stderr)

    def test_set_kid_drops_an_old_signature(self):
        self.run_tool('set-kid', self.path, '0123abcd')
        self.run_tool('attach-sig', self.path, base64.b64encode(sig_der(3, 4)).decode())
        self.run_tool('set-kid', self.path, '89abcdef')
        with open(self.path) as f:
            self.assertNotIn('sig', json.load(f))

    def test_kid_of_prints_the_key_id(self):
        r = self.run_tool('kid-of', base64.b64encode(b'abc').decode())
        self.assertEqual(r.stdout.decode().strip(), manifest.key_id(b'abc'))


@unittest.skipUnless(HAVE_OPENSSL, 'the fake KMS needs the openssl CLI')
class SigningScriptTest(test_scripts.ScriptTest):
    """publish-data.sh with SIGNING_KEY_ARN set, against the fake KMS."""

    def setUp(self):
        # Only the tests written here: the inherited ones (the unsigned publish and the shell deploy) already run in ScriptTest.
        if self._testMethodName not in type(self).__dict__:
            self.skipTest('inherited from ScriptTest')
        super().setUp()
        self.key = os.path.join(self.tmp, 'key.pem')
        subprocess.run(['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', self.key], check=True, capture_output=True)
        self.env.update(FAKE_KMS_KEY=self.key)
        self.spki = subprocess.run(['openssl', 'ec', '-in', self.key, '-pubout', '-outform', 'DER'], check=True, capture_output=True).stdout

    def signed_publish(self, dist, **env):
        return self.publish(dist, SIGNING_KEY_ARN=KEY_ARN, **env)

    def assert_valid_signature(self, pointer):
        """openssl, not our code: a valid ECDSA P-256 signature over the canonical bytes, by the key the manifest names."""
        self.assertEqual(pointer['kid'], manifest.key_id(self.spki))
        d = tempfile.mkdtemp(dir=self.tmp)
        pub = os.path.join(d, 'pub.pem')
        subprocess.run(['openssl', 'ec', '-in', self.key, '-pubout', '-out', pub], check=True, capture_output=True)
        for name, data in (('msg', manifest.canonical(pointer)), ('sig', raw_to_der(base64.b64decode(pointer['sig'])))):
            with open(os.path.join(d, name), 'wb') as f:
                f.write(data)
        return subprocess.run(['openssl', 'dgst', '-sha256', '-verify', pub, '-signature', os.path.join(d, 'sig'), os.path.join(d, 'msg')],
                              capture_output=True).returncode == 0

    def test_the_pointer_carries_a_signature_that_verifies(self):
        r = self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        p = self.pointer()
        self.assertTrue(self.assert_valid_signature(p))
        manifest.validate_manifest(p)

    def test_the_signature_covers_every_field(self):
        self.assertEqual(self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32)).returncode, 0)
        for field, value in (('sha256', 'cd' * 32), ('date', '2026-11-02'), ('bytes', 999), ('built', '2026-11-01T09:00:01Z'), ('kid', '00000000')):
            p = dict(self.pointer(), **{field: value})
            if field == 'kid':
                self.assertNotEqual(p['kid'], manifest.key_id(self.spki))
                continue
            self.assertFalse(self.assert_valid_signature(p), field)

    def test_unsigned_when_no_key_is_configured_and_no_kms_call_is_made(self):
        r = self.publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        p = self.pointer()
        self.assertNotIn('sig', p)
        self.assertNotIn('kid', p)
        self.assertEqual([c for c in self.calls() if c['op'].startswith('kms')], [])

    def test_the_manifest_is_signed_before_the_pointer_is_written_and_the_key_is_the_configured_one(self):
        self.assertEqual(self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32), FAKE_KMS_ALLOW_KEY=KEY_ARN).returncode, 0)
        calls = self.calls()
        names = [c['op'] if c['op'].startswith('kms') else (c['op'] + ':' + c['key']) for c in calls if c['op'].startswith('kms') or c['op'] == 'put']
        self.assertEqual([n for n in names if n.startswith('kms')], ['kms-get-public-key', 'kms-sign', 'kms-verify'])
        self.assertGreater(names.index('put:data/latest.json'), names.index('kms-verify'), 'signed and checked before the pointer moves')
        self.assertEqual(names[-1], 'put:data/latest.json', 'the pointer is still the last write')
        self.assertTrue(all(c['key'] == KEY_ARN for c in calls if c['op'].startswith('kms')))

    def test_a_failing_sign_publishes_no_pointer(self):
        r = self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32), FAKE_KMS_FAIL='sign')
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn('data/latest.json', self.keys())

    def test_a_signature_the_key_does_not_accept_publishes_no_pointer(self):
        r = self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32), FAKE_KMS_FAIL='verify')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('did not accept its own signature', r.stderr)
        self.assertNotIn('data/latest.json', self.keys())

    def test_a_failing_sign_leaves_the_old_pointer_in_place(self):
        self.assertEqual(self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32)).returncode, 0)
        before = self.read('data/latest.json')
        r = self.signed_publish(self.make_dist('b', '2026-11-02T09:00:00Z', 'bb' * 32), FAKE_KMS_FAIL='sign')
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.read('data/latest.json'), before)

    def test_a_rollback_is_signed_too(self):
        self.assertEqual(self.signed_publish(self.make_dist('a', '2026-11-01T09:00:00Z', 'aa' * 32)).returncode, 0)
        first = self.pointer()
        self.assertEqual(self.signed_publish(self.make_dist('b', '2026-11-02T09:00:00Z', 'bb' * 32)).returncode, 0)
        r = self.run_script(os.path.join(ROOT, 'scripts', 'ci', 'publish-data.sh'), 'rollback', first['date'], test_scripts.BUCKET, SIGNING_KEY_ARN=KEY_ARN)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        p = self.pointer()
        self.assertEqual(p['date'], first['date'])
        self.assertTrue(self.assert_valid_signature(p))


if __name__ == '__main__':
    unittest.main()
