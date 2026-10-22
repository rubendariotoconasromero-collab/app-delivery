import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReviewTransition,
  detectDocumentMime,
  documentsValid,
  parseInput,
  todayIn,
  validateExpiration,
  vehicleInput,
} from '../src/drivers/driver.rules';

test('vehicle input rejects privilege fields, duplicates and invalid capacity', () => {
  const vehicle = {
    plate: 'abc-1234',
    make: 'Toyota',
    model: 'Corolla',
    year: 2020,
    capacityPassengers: 4,
    serviceTypes: ['passengers', 'parcels'],
  };
  assert.equal(parseInput(vehicleInput, vehicle).plate, 'ABC-1234');
  assert.throws(() => parseInput(vehicleInput, { ...vehicle, reviewStatus: 'approved' }));
  assert.throws(() => parseInput(vehicleInput, { ...vehicle, capacityPassengers: 0 }));
  assert.throws(() =>
    parseInput(vehicleInput, { ...vehicle, serviceTypes: ['passengers', 'passengers'] }),
  );
});

test('document validation uses signatures and real future dates', () => {
  assert.equal(detectDocumentMime(Buffer.from('%PDF-1.4\nfixture')), 'application/pdf');
  assert.throws(() => detectDocumentMime(Buffer.from('<script>alert(1)</script>')));
  assert.throws(() => validateExpiration('driver_license', undefined, '2026-10-22'));
  assert.throws(() => validateExpiration('driver_license', '2027-02-31', '2026-10-22'));
  assert.throws(() => validateExpiration('driver_license', '2026-10-22', '2026-10-22'));
  assert.equal(validateExpiration('driver_license', '2027-10-22', '2026-10-22'), '2027-10-22');
  assert.equal(validateExpiration('identity_document', undefined, '2026-10-22'), null);
});

test('expired or missing documents prevent approval and draft cannot be approved', () => {
  assert.equal(
    documentsValid(
      [{ kind: 'driver_license', expiresOn: '2026-10-21' }],
      ['driver_license'],
      '2026-10-22',
    ),
    false,
  );
  assert.equal(documentsValid([], ['vehicle_registration'], '2026-10-22'), false);
  assert.throws(() => assertReviewTransition('draft', 'approve'));
  assert.equal(assertReviewTransition('pending', 'approve'), 'approved');
  assert.equal(assertReviewTransition('approved', 'suspend'), 'suspended');
  assert.match(todayIn('America/La_Paz'), /^\d{4}-\d{2}-\d{2}$/);
});
