// superwall-staff-key: the `superwall` CLI's staff access key.
//
// One P-256 key in the Mac's Secure Enclave per CLI install. The private key never leaves
// the Enclave; what is stored on disk is CryptoKit's `dataRepresentation`, a handle the
// Enclave encrypted with its own key, which no other Mac (and no other process that lacks
// this Mac's Enclave) can turn back into a signing key.
//
// The CLI talks to this binary with one JSON request on stdin and reads one JSON response
// on stdout (protocol version 1, documented in ../../README.md). The binary only ever signs
// DPoP proofs (RFC 9449) that it builds itself: it is not a general signing oracle.

import CryptoKit
import Foundation
import Security

let protocolVersion = 1
let helperVersion = "0.1.0"
/// The furthest a proof's `iat` may be from this Mac's clock. The CLI corrects for the
/// api's clock (its `Date` header); a bigger gap means a wrong clock, not skew, and a cap
/// stops proofs being signed now for use far in the future.
let maxIatSkewSeconds: Int64 = 120
let maxRequestBytes = 64 * 1024
let maxHtuLength = 2048
let keyFileKind = "secure-enclave-p256"

struct HelperError: Error {
  let code: String
  let message: String
}

// MARK: - Request

struct Request: Decodable {
  let v: Int?
  let op: String?
  let key: String?
  let replace: Bool?
  let htm: String?
  let htu: String?
  let ath: String?
  let iat: Int64?
}

// MARK: - Encoding helpers

func base64url(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

/// A JSON string literal. Inputs are validated ASCII already; this is belt and braces.
func jsonString(_ value: String) -> String {
  var out = "\""
  for scalar in value.unicodeScalars {
    switch scalar {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case _ where scalar.value < 0x20: out += String(format: "\\u%04x", scalar.value)
    default: out.unicodeScalars.append(scalar)
    }
  }
  return out + "\""
}

func matches(_ value: String, _ pattern: String) -> Bool {
  value.range(of: pattern, options: .regularExpression) != nil
}

// MARK: - Key file

struct KeyFile: Codable {
  let v: Int
  let kind: String
  let data: String
}

func keyPath(_ request: Request) throws -> URL {
  guard let path = request.key, path.hasPrefix("/"), !path.contains("\0"), path.count <= 1024 else {
    throw HelperError(code: "bad_request", message: "`key` must be an absolute path")
  }
  return URL(fileURLWithPath: path).standardizedFileURL
}

func loadKey(_ url: URL) throws -> SecureEnclave.P256.Signing.PrivateKey {
  guard FileManager.default.fileExists(atPath: url.path) else {
    throw HelperError(code: "key_not_found", message: "No staff key at \(url.path)")
  }
  guard
    let raw = FileManager.default.contents(atPath: url.path),
    let file = try? JSONDecoder().decode(KeyFile.self, from: raw),
    file.v == 1, file.kind == keyFileKind,
    let blob = Data(base64Encoded: file.data)
  else {
    throw HelperError(code: "key_invalid", message: "\(url.path) is not a staff key file")
  }
  do {
    return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
  } catch {
    // Made by another Mac's Enclave, or this Enclave was reset.
    throw HelperError(code: "key_invalid", message: "This Mac's Secure Enclave can't use the key at \(url.path)")
  }
}

/// Writes the key file with mode 0600: to a temporary file in the same directory, then
/// linked into place (fails if a key is there) or renamed over it (`replace`).
func storeKey(_ key: SecureEnclave.P256.Signing.PrivateKey, at url: URL, replace: Bool) throws {
  let dir = url.deletingLastPathComponent()
  do {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  } catch {
    throw HelperError(code: "io_failed", message: "Can't create \(dir.path)")
  }
  let file = KeyFile(v: 1, kind: keyFileKind, data: key.dataRepresentation.base64EncodedString())
  let body = try JSONEncoder().encode(file)
  let tmp = dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
  guard FileManager.default.createFile(atPath: tmp.path, contents: body, attributes: [.posixPermissions: 0o600]) else {
    throw HelperError(code: "io_failed", message: "Can't write \(tmp.path)")
  }
  defer { unlink(tmp.path) }
  if replace {
    guard rename(tmp.path, url.path) == 0 else {
      throw HelperError(code: "io_failed", message: "Can't write \(url.path)")
    }
  } else if link(tmp.path, url.path) != 0 {
    if errno == EEXIST {
      throw HelperError(code: "key_exists", message: "A staff key already exists at \(url.path)")
    }
    throw HelperError(code: "io_failed", message: "Can't write \(url.path)")
  }
}

// MARK: - JWK

struct PublicJwk {
  let x: String
  let y: String

  init(_ key: P256.Signing.PublicKey) {
    // X9.63: 0x04 || X (32 bytes) || Y (32 bytes).
    let point = key.x963Representation
    x = base64url(point.subdata(in: 1..<33))
    y = base64url(point.subdata(in: 33..<65))
  }

  /// The members of an EC public JWK in RFC 7638 order, which is also the order the api
  /// hashes for the thumbprint.
  var json: String { "{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"\(x)\",\"y\":\"\(y)\"}" }

  /// RFC 7638 thumbprint (SHA-256, base64url).
  var thumbprint: String { base64url(Data(SHA256.hash(data: Data(json.utf8)))) }

  var dictionary: [String: Any] { ["kty": "EC", "crv": "P-256", "x": x, "y": y] }
}

// MARK: - Operations

func versionInfo() -> [String: Any] {
  ["helper": helperVersion, "protocol": protocolVersion, "secureEnclave": SecureEnclave.isAvailable]
}

func requireEnclave() throws {
  guard SecureEnclave.isAvailable else {
    throw HelperError(code: "no_secure_enclave", message: "This Mac has no Secure Enclave")
  }
}

func create(_ request: Request) throws -> [String: Any] {
  try requireEnclave()
  let url = try keyPath(request)
  var cfError: Unmanaged<CFError>?
  // `.privateKeyUsage` alone: the key signs whenever the Mac is unlocked, with no Touch ID
  // per proof. The human check is the passkey tap at the staff access authority that opens
  // the session; a proof only ever accompanies a grant that tap paid for. ThisDeviceOnly
  // keeps it out of backups and migrations.
  guard
    let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &cfError)
  else {
    throw HelperError(code: "secure_enclave_failed", message: "Can't create the key's access control")
  }
  let key: SecureEnclave.P256.Signing.PrivateKey
  do {
    key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
  } catch {
    throw HelperError(code: "secure_enclave_failed", message: "The Secure Enclave refused to create a key: \(error)")
  }
  try storeKey(key, at: url, replace: request.replace ?? false)
  let jwk = PublicJwk(key.publicKey)
  return ["jwk": jwk.dictionary, "jkt": jwk.thumbprint]
}

func publicKey(_ request: Request) throws -> [String: Any] {
  try requireEnclave()
  let jwk = PublicJwk(try loadKey(try keyPath(request)).publicKey)
  return ["jwk": jwk.dictionary, "jkt": jwk.thumbprint]
}

/// `htu` must arrive already in the form the api compares: origin + path (no query,
/// fragment or credentials), https, or http on a loopback host for local development.
func checkHtu(_ htu: String?) throws -> String {
  let bad = HelperError(code: "bad_request", message: "`htu` must be an https origin + path, without query or fragment")
  guard let htu, htu.count <= maxHtuLength, let parts = URLComponents(string: htu),
    let scheme = parts.scheme, let host = parts.percentEncodedHost, !host.isEmpty,
    parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
    parts.percentEncodedPath.hasPrefix("/")
  else { throw bad }
  let loopback = ["localhost", "127.0.0.1", "[::1]"].contains(host)
  guard scheme == "https" || (scheme == "http" && loopback) else { throw bad }
  let defaultPort = scheme == "https" ? 443 : 80
  if let port = parts.port, port == defaultPort { throw bad }
  let rebuilt = "\(scheme)://\(host)\(parts.port.map { ":\($0)" } ?? "")\(parts.percentEncodedPath)"
  guard rebuilt == htu, host == host.lowercased() else { throw bad }
  return htu
}

func sign(_ request: Request) throws -> [String: Any] {
  try requireEnclave()
  guard let htm = request.htm, matches(htm, "^[A-Z]{1,16}$") else {
    throw HelperError(code: "bad_request", message: "`htm` must be an upper-case HTTP method")
  }
  let htu = try checkHtu(request.htu)
  if let ath = request.ath, !matches(ath, "^[A-Za-z0-9_-]{43}$") {
    throw HelperError(code: "bad_request", message: "`ath` must be a base64url SHA-256 (43 characters)")
  }
  let now = Int64(Date().timeIntervalSince1970)
  let iat = request.iat ?? now
  guard abs(iat - now) <= maxIatSkewSeconds else {
    throw HelperError(code: "clock_skew", message: "`iat` is more than \(maxIatSkewSeconds) s from this Mac's clock; check the date and time settings")
  }
  let key = try loadKey(try keyPath(request))
  let jwk = PublicJwk(key.publicKey)

  var random = [UInt8](repeating: 0, count: 16)
  guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
    throw HelperError(code: "secure_enclave_failed", message: "No random bytes for the proof's jti")
  }
  let jti = base64url(Data(random))

  let header = "{\"alg\":\"ES256\",\"typ\":\"dpop+jwt\",\"jwk\":\(jwk.json)}"
  var claims = "{\"jti\":\(jsonString(jti)),\"htm\":\(jsonString(htm)),\"htu\":\(jsonString(htu)),\"iat\":\(iat)"
  if let ath = request.ath { claims += ",\"ath\":\(jsonString(ath))" }
  claims += "}"
  let signingInput = "\(base64url(Data(header.utf8))).\(base64url(Data(claims.utf8)))"
  let signature: P256.Signing.ECDSASignature
  do {
    signature = try key.signature(for: Data(signingInput.utf8))
  } catch {
    throw HelperError(code: "secure_enclave_failed", message: "The Secure Enclave refused to sign: \(error)")
  }
  // JWS ES256 wants raw r || s (64 bytes), not DER.
  return ["proof": "\(signingInput).\(base64url(signature.rawRepresentation))", "jkt": jwk.thumbprint, "jti": jti, "iat": iat]
}

func delete(_ request: Request) throws -> [String: Any] {
  let url = try keyPath(request)
  guard FileManager.default.fileExists(atPath: url.path) else { return ["deleted": false] }
  // Only a staff key file: the helper is not a way to delete arbitrary files.
  guard
    let raw = FileManager.default.contents(atPath: url.path),
    let file = try? JSONDecoder().decode(KeyFile.self, from: raw), file.kind == keyFileKind
  else {
    throw HelperError(code: "key_invalid", message: "\(url.path) is not a staff key file")
  }
  // The Enclave keeps nothing per key: without this handle the key is gone for good.
  guard unlink(url.path) == 0 else {
    throw HelperError(code: "io_failed", message: "Can't delete \(url.path)")
  }
  return ["deleted": true]
}

// MARK: - Main

func respond(_ body: [String: Any], ok: Bool) -> Never {
  var response = body
  response["v"] = protocolVersion
  response["ok"] = ok
  let data = (try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{\"ok\":false,\"v\":1}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(ok ? 0 : 1)
}

func fail(_ error: HelperError) -> Never {
  respond(["error": ["code": error.code, "message": error.message]], ok: false)
}

if CommandLine.arguments.dropFirst().contains("--version") {
  print("superwall-staff-key \(helperVersion) (protocol \(protocolVersion))")
  exit(0)
}

var input = Data()
while input.count <= maxRequestBytes {
  let chunk = FileHandle.standardInput.availableData
  if chunk.isEmpty { break }
  input.append(chunk)
}
guard input.count <= maxRequestBytes else {
  fail(HelperError(code: "bad_request", message: "The request is larger than \(maxRequestBytes) bytes"))
}
guard let request = try? JSONDecoder().decode(Request.self, from: input) else {
  fail(HelperError(code: "bad_request", message: "The request is not a JSON object"))
}
guard request.v == protocolVersion else {
  fail(HelperError(code: "unsupported_version", message: "This helper speaks protocol \(protocolVersion), not \(request.v.map(String.init) ?? "none")"))
}

do {
  switch request.op {
  case "version": respond(versionInfo(), ok: true)
  case "create": respond(try create(request), ok: true)
  case "public": respond(try publicKey(request), ok: true)
  case "sign": respond(try sign(request), ok: true)
  case "delete": respond(try delete(request), ok: true)
  default: fail(HelperError(code: "bad_request", message: "Unknown op \(request.op ?? "none")"))
  }
} catch let error as HelperError {
  fail(error)
} catch {
  fail(HelperError(code: "internal", message: "\(error)"))
}
