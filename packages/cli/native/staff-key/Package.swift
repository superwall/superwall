// swift-tools-version:5.9
import PackageDescription

// The staff access key helper: a P-256 key in the Mac's Secure Enclave that signs DPoP
// proofs for the `superwall` CLI. See README.md for the protocol and the release steps.
let package = Package(
  name: "superwall-staff-key",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(
      name: "superwall-staff-key",
      path: "Sources/superwall-staff-key"
    )
  ]
)
