# superwall-staff-key

The `superwall` CLI's staff access key: one P-256 key in the Mac's Secure Enclave, used to
sign the DPoP proofs (RFC 9449) that staff grants need on every api request. The CLI calls
it through `src/core/staff/key.ts`; nothing else should.

macOS only (`STAFF_ACCESS_PLATFORMS` in `key.ts`). On any other platform the CLI refuses
before running the helper: "Staff access needs macOS". There is no fallback to a key in a
file.

## The key

- **Created by CryptoKit** (`SecureEnclave.P256.Signing.PrivateKey`). The private key is
  generated inside the Enclave and can't be exported by anyone, this binary included.
- **Stored as the Enclave's wrapped handle**, not as a Keychain item. CryptoKit's
  `dataRepresentation` is an opaque blob the Enclave encrypted with its own key; only this
  Mac's Enclave can turn it back into a signing key. The helper writes it to
  `~/.superwall/staff/key.json` (mode 0600, directory 0700). Copying the file to another
  machine gives nothing. Deleting it deletes the key: the Enclave keeps nothing per key.
  - Why not a Keychain item (`kSecAttrTokenIDSecureEnclave`, `kSecAttrIsPermanent`): a
    permanent Secure Enclave key in the data protection keychain needs the
    `keychain-access-groups` entitlement, which needs a provisioning profile, which a bare
    command-line binary can't carry. The protection is the same: in both cases the private
    key lives in the Enclave and what's on disk is useless elsewhere.
- **Access control:** `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` with
  `.privateKeyUsage`, and no `.userPresence` / `.biometryCurrentSet`.
  - The CLI signs a fresh proof for every api request (the api accepts a proof for 15 s and
    only once), often many per command. Touch ID per signature would be a prompt per
    request, and people who are prompted all day stop reading the prompt.
  - The human check is the passkey tap at the staff access authority, once a day for the
    session and again for each sensitive action. A proof is worth nothing without a grant
    that tap paid for, and a grant is worth nothing without a proof from this Mac.
  - `WhenUnlocked`: the key signs only while the Mac is unlocked. `ThisDeviceOnly`: never in
    a backup or a migration to a new Mac (a new Mac enrols a new key).
- **Not a signing oracle.** The helper signs only DPoP proofs it builds itself, with a
  `jti` it generates, `htu` already in the api's canonical form, and an `iat` within 120 s
  of the Mac's clock (so proofs can't be signed now for use much later). It never signs
  caller-supplied bytes.

## Protocol (version 1)

One JSON request on stdin, one JSON response on stdout, then exit (0 when `ok`, 1 when
not). Every request and response carries `"v": 1`. A helper that doesn't speak the
request's version answers `unsupported_version`; the CLI refuses a response whose `v` isn't
the one it speaks. New fields are additive within a version; anything else is a new `v`.
`superwall-staff-key --version` prints the helper and protocol versions for humans.

| `op` | Request fields | Response fields (`ok: true`) |
|---|---|---|
| `version` | | `helper` (semver), `protocol` (1), `secureEnclave` (bool) |
| `create` | `key` (absolute path), `replace` (bool, default false) | `jwk`, `jkt` |
| `public` | `key` | `jwk`, `jkt` |
| `sign` | `key`, `htm`, `htu`, `ath`?, `iat`? | `proof`, `jkt`, `jti`, `iat` |
| `delete` | `key` | `deleted` (false when there was no key) |

- `jwk` is `{ "kty": "EC", "crv": "P-256", "x", "y" }`, public members only. `jkt` is its
  RFC 7638 thumbprint, what a grant's `cnf.jkt` names. The CLI recomputes it and refuses a
  mismatch.
- `htm`: upper-case method. `htu`: origin + path, exactly as the api compares it (no query,
  fragment, credentials or default port; lower-case host; `https`, or `http` on
  `localhost`/`127.0.0.1`/`[::1]`). The CLI normalises a URL with WHATWG `URL`, as the api
  does. `ath`: base64url SHA-256 (43 characters) of the grant (api calls) or session token
  (authority calls); omitted only for a call that carries neither. `iat`: Unix seconds, the
  CLI's clock corrected for the server's `Date`; default now; refused (`clock_skew`) beyond
  120 s of the Mac's clock.
- `proof` is a compact JWS: header `{"alg":"ES256","typ":"dpop+jwt","jwk":{…}}`, claims
  `{"jti","htm","htu","iat","ath"?}`, signature raw r‖s (64 bytes), as the api's
  `verifyDpopProof` expects. `jti` is 16 random bytes, base64url.
- `delete` removes only a file that is a staff key file (`key_invalid` otherwise).

Errors: `{ "v": 1, "ok": false, "error": { "code", "message" } }`, with `code` one of
`bad_request`, `unsupported_version`, `no_secure_enclave`, `key_exists`, `key_not_found`,
`key_invalid` (not a key file, or another Mac's / a reset Enclave's key), `clock_skew`,
`secure_enclave_failed`, `io_failed`, `internal`. The CLI adds `unsupported_platform`,
`helper_missing` and `helper_failed` (crash, timeout, or an answer that isn't protocol).

Key file: `{ "v": 1, "kind": "secure-enclave-p256", "data": "<base64 dataRepresentation>" }`.

## Building and testing

```sh
bun run build:staff-key          # universal (arm64 + x86_64) → dist/native/superwall-staff-key
swift build -c release --package-path native/staff-key   # quick local build
```

`tests/core/staff/key.test.ts` covers the wrapper against a fake helper
(`tests/fixtures/staff-key/fake-helper.mjs`, a software key) and runs everywhere.
`tests/core/staff/key.secure-enclave.test.ts` runs the real helper on this Mac's Enclave
(create, sign, verify with the api's checks, replace, delete, and the helper's own
refusals); it skips on Linux and when the helper isn't built. Point it at a particular
binary with `SUPERWALL_STAFF_KEY_LIVE_HELPER`. `SUPERWALL_STAFF_KEY_HELPER` points the CLI
itself at a helper other than the packaged one.

## Releasing (needs Brian)

The helper ships inside the npm package at `dist/native/superwall-staff-key`. Release builds
run on Ubuntu today, so the helper isn't in a published package yet. Before
`superwall staff` ships:

1. **Developer ID certificate.** A "Developer ID Application" certificate for the Superwall
   team (Apple Developer account holder or admin creates it in Certificates, Identifiers &
   Profiles), exported as a .p12 for CI. No provisioning profile and no entitlements are
   needed: the helper uses no Keychain items.
2. **Notarization credentials.** An App Store Connect API key (Developer role is enough) for
   `xcrun notarytool`, stored as a keychain profile on the signing machine
   (`xcrun notarytool store-credentials`) or as CI secrets.
3. **A macOS release job.** Build, sign and notarize on a macOS runner, then hand
   `dist/native/superwall-staff-key` to the Ubuntu publish job before `npm pack`:
   ```sh
   SUPERWALL_STAFF_KEY_SIGN_IDENTITY="Developer ID Application: Superwall … (TEAMID)" \
   SUPERWALL_STAFF_KEY_NOTARY_PROFILE=superwall-notary \
   bun run build:staff-key
   ```
   This signs with the hardened runtime, a secure timestamp and the identifier
   `com.superwall.cli.staff-key`, then notarizes. A bare Mach-O can't be stapled, so
   Gatekeeper checks the notarization online if the file is ever quarantined (npm doesn't
   quarantine what it installs). The binary was tested here ad-hoc signed with the hardened
   runtime: the Secure Enclave works with no entitlements.
4. **Verify the release artefact** on a clean Mac: `codesign --verify --strict --verbose=2`,
   `spctl --assess --type execute -v` (expects "Notarized Developer ID"), then
   `superwall-staff-key --version`.
5. **Pinning the signer (optional, later).** Once there is a team ID, the CLI could check
   the helper's signature (`codesign --verify -R 'anchor apple generic and certificate
   leaf[subject.OU] = "TEAMID"'`) before using it. Its value is limited: whoever can
   replace the helper in the npm install can also edit the CLI's JavaScript, and either way
   the Enclave never gives up the key, only signatures while that code runs as the staffer.
