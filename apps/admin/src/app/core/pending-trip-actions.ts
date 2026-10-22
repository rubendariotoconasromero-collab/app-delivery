const prefix = 'appdelivery:pending-trip:';
export interface PendingTripAction {
  actorId: string;
  tripId: string;
  operation: 'assign' | 'cancel';
  idempotencyKey: string;
  driverId?: string;
  reason: string;
}
function storageKey(
  actorId: string,
  tripId: string,
  operation: PendingTripAction['operation'],
): string {
  return `${prefix}${encodeURIComponent(actorId)}:${encodeURIComponent(tripId)}:${operation}`;
}
export function savePendingTripAction(action: PendingTripAction): void {
  try {
    sessionStorage.setItem(
      storageKey(action.actorId, action.tripId, action.operation),
      JSON.stringify(action),
    );
  } catch {
    throw new Error(
      'No se pudo guardar el identificador del intento en esta pestaña. Habilita el almacenamiento de sesión antes de enviar la operación.',
    );
  }
}
export function pendingTripAction(
  actorId: string,
  tripId: string,
  operation: PendingTripAction['operation'],
): PendingTripAction | null {
  try {
    const raw = sessionStorage.getItem(storageKey(actorId, tripId, operation));
    if (!raw) return null;
    const action: PendingTripAction = JSON.parse(raw);
    if (
      action.actorId !== actorId ||
      action.tripId !== tripId ||
      action.operation !== operation ||
      typeof action.idempotencyKey !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(action.idempotencyKey) ||
      typeof action.reason !== 'string' ||
      action.reason.length < 3 ||
      action.reason.length > 1000 ||
      (operation === 'assign' && typeof action.driverId !== 'string')
    )
      return null;
    return action;
  } catch {
    return null;
  }
}
export function removePendingTripAction(
  actorId: string,
  tripId: string,
  operation: PendingTripAction['operation'],
): void {
  try {
    sessionStorage.removeItem(storageKey(actorId, tripId, operation));
  } catch {
    /* Storage can be disabled after the action. */
  }
}
export function clearPendingTripActions(): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    );
    for (const key of keys) if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    /* A closed or restricted storage has no accessible pending data. */
  }
}
