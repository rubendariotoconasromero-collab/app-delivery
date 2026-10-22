import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_core/src/trip_money.dart';

void main() {
  test('cash amounts retain centavos and reject fractional centavos', () {
    expect(parseBolivianos('12,30'), 1230);
    expect(parseBolivianos('0.10'), 10);
    expect(parseBolivianos('25'), 2500);
    expect(parseBolivianos('1.235'), isNull);
    expect(parseBolivianos('-10'), isNull);
    expect(parseBolivianos('1e3'), isNull);
    expect(bolivianos(1230), 'Bs 12.30');
    expect(bolivianos(10), 'Bs 0.10');
  });
}
