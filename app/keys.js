// Public keys that may sign the timetable manifest (data/latest.json), as { <key id>: <base64 SubjectPublicKeyInfo> }.
// The key id is the first 8 hex characters of the sha256 of the SubjectPublicKeyInfo (build/manifest.py kid-of).
// The keys are ECDSA P-256 public keys of AWS KMS keys that only the data role may use (site-infra).
//
// With a key listed, a manifest without a valid signature by a listed key is refused and the data on the device stays.
// With none listed, the app checks the hashes of a build and does not look for a signature, as before the signing existed.
// Rotation: list the new key here, release, switch the signing key, and remove the old one a release later.
export const MANIFEST_KEYS = {
  d5c56622: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEP+gzoD2lqmv/46iKXfQqHIMI9zjgm9fhlRDjCMLDjwQAvLPCBZYJA5VvGWzkTkSQWlUpZ1y4MWU965UbZ8DiIQ==',
};
