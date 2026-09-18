import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

/// Blocks the app until the user updates.
class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key, required this.minimumVersion});

  final String minimumVersion;
  static const storeUrl = 'https://play.google.com/store/apps/details?id=com.acme.app';
  static const productId = 'acme_pro_annual';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Image.asset('assets/rocket.png'),
          const Icon(Icons.system_update),
          const Text('Update required'),
          Text('Version $minimumVersion fixes sign-in.'),
          ElevatedButton(
            onPressed: () => launchUrl(Uri.parse(storeUrl)),
            child: const Text('Update now'),
          ),
          TextButton(
            onPressed: () => InAppPurchase.instance.buyNonConsumable(purchaseParam: param),
            child: const Text('Go Pro instead'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Not now'),
          ),
        ],
      ),
    );
  }
}
