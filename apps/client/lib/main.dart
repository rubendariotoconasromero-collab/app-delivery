import 'package:flutter/material.dart';
import 'package:mobile_core/mobile_core.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ClientApp());
}

class ClientApp extends StatelessWidget {
  const ClientApp({super.key, this.apiClient, this.sessionStore});

  final ApiClient? apiClient;
  final SessionStore? sessionStore;

  @override
  Widget build(BuildContext context) => AppDeliveryApp(
    audience: AppAudience.client,
    apiClient: apiClient,
    sessionStore: sessionStore,
  );
}
