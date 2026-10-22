import 'package:flutter/material.dart';
import 'package:mobile_core/mobile_core.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DriverApp());
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key, this.apiClient, this.sessionStore});

  final ApiClient? apiClient;
  final SessionStore? sessionStore;

  @override
  Widget build(BuildContext context) => AppDeliveryApp(
    audience: AppAudience.driver,
    apiClient: apiClient,
    sessionStore: sessionStore,
  );
}
