import {
  clearPendingTripActions,
  pendingTripAction,
  savePendingTripAction,
} from './pending-trip-actions';

describe('Intentos operativos pendientes', () => {
  afterEach(() => sessionStorage.clear());
  it('aísla las acciones por cuenta, viaje y operación y limpia solo sus datos de la sesión', () => {
    savePendingTripAction({
      actorId: 'operator-1',
      tripId: 'trip-1',
      operation: 'assign',
      idempotencyKey: '7c3c3edb-a575-4d7b-a6ae-b42c32f1e1d6',
      driverId: 'driver-1',
      reason: 'Candidato disponible',
    });
    sessionStorage.setItem('unrelated-preference', 'test');
    expect(pendingTripAction('operator-1', 'trip-1', 'assign')?.driverId).toBe('driver-1');
    expect(pendingTripAction('operator-2', 'trip-1', 'assign')).toBeNull();
    expect(pendingTripAction('operator-1', 'trip-2', 'assign')).toBeNull();
    expect(pendingTripAction('operator-1', 'trip-1', 'cancel')).toBeNull();
    clearPendingTripActions();
    expect(pendingTripAction('operator-1', 'trip-1', 'assign')).toBeNull();
    expect(sessionStorage.getItem('unrelated-preference')).toBe('test');
  });
});
