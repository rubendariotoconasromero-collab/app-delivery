/// Monetary API values are integer centavos. Never round a floating payment.
String bolivianos(int centavos) =>
    'Bs ${(centavos ~/ 100)}.${(centavos.abs() % 100).toString().padLeft(2, '0')}';

int? parseBolivianos(String input) {
  final normalized = input.trim().replaceAll(',', '.');
  if (!RegExp(r'^\d{1,6}(\.\d{1,2})?$').hasMatch(normalized)) return null;
  final parts = normalized.split('.');
  final value =
      int.parse(parts[0]) * 100 +
      (parts.length == 1 ? 0 : int.parse(parts[1].padRight(2, '0')));
  return value <= 10000000 ? value : null;
}
