import UIKit

final class LegacyUpdateViewController: UIViewController {
  private let titleLabel = UILabel()
  private let updateButton = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad()
    titleLabel.text = "Update required"
    updateButton.setTitle("Update now", for: .normal)
    updateButton.addTarget(self, action: #selector(update), for: .touchUpInside)
    view.addSubview(UIImageView(image: UIImage(named: "rocket")))
  }

  @objc private func update() {
    UIApplication.shared.open(URL(string: "https://apps.apple.com/app/id123456789")!)
    dismiss(animated: true)
  }
}
