// Public keys that may sign the timetable manifest (data/latest.json), as { <key id>: <base64 SubjectPublicKeyInfo> }.
// The key id is the first 8 hex characters of the sha256 of the SubjectPublicKeyInfo (build/manifest.py kid-of).
// The keys are ECDSA P-256 public keys of AWS KMS keys that only the data role may use (site-infra).
//
// Empty: the app checks the hashes of a build and does not look for a signature, as before the signing existed. As soon as
// one key is listed, a manifest without a valid signature by a listed key is refused and the data on the device stays.
// Rotation: list the new key here, release, switch the signing key, and remove the old one a release later.
export const MANIFEST_KEYS = {};
