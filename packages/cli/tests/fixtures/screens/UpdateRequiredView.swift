import SwiftUI
import StoreKit

// Shown when the backend says this build is too old.
struct UpdateRequiredView: View {
  @Environment(\.openURL) private var openURL
  @Environment(\.dismiss) private var dismiss
  let minimumVersion: String
  let storeURL = URL(string: "https://apps.apple.com/app/id123456789")!
  let productId = "com.acme.pro.annual"

  var body: some View {
    VStack(spacing: 16) {
      Image("rocket")
        .resizable()
        .frame(width: 96, height: 96)
      Image(systemName: "arrow.down.circle.fill")
      Text("Update required")
        .font(.custom("Inter-Bold", size: 28))
      Text("Version \(minimumVersion) fixes sign-in. Update to keep using Acme.")
        .multilineTextAlignment(.center)
      Button("Update now") {
        openURL(storeURL)
      }
      .buttonStyle(.borderedProminent)
      Button("Remind me later") { dismiss() }
      Link("What's new", destination: URL(string: "https://acme.example/changelog")!)
    }
    .padding(24)
    .onAppear { /* analytics: "update_required_shown" */ }
    .accessibilityLabel("Update required screen")
  }

  private func review() {
    SKStoreReviewController.requestReview()
  }
}
