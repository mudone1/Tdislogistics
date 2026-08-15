// Thrown by the shared VARS/KIU automation the moment it notices (at one of
// its existing stage checkpoints) that the BookingJob it's running has been
// marked CANCELLED — see the isCancelled param on bookVarsPlatformOnHold/
// bookValueJetOnHold and executeBookingAutomation's special-casing of this
// error class in connector-service/src/server.ts (must be checked BEFORE
// the generic catch-all that would otherwise call markFailed and overwrite
// the CANCELLED status).
export class BookingCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingCancelledError";
  }
}
