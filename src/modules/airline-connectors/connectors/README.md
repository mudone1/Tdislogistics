# Adding a new connector (Phase 2 — Category B)

Category B airlines (United, Rano, XEJet) are still **not implemented** —
they use different booking platforms with different login and navigation
flows, so they don't fit `BaseCraneConnector`. **Enugu Air is now
implemented** (see `connectors/enugu/EnuguConnector.ts`) as the first
Category B connector — a real, working example of the pattern below,
built against a VARS/Videcom ASP.NET WebForms agent portal (not Crane).

To add one later, **without changing any existing file**:

1. Add the airline to `AirlineKey` in `core/types.ts` and to the
   `AirlineKey` enum in `prisma/schema.prisma` (run `prisma migrate dev`
   after).
2. Create `connectors/<airline>/<Airline>Connector.ts` that `extends
   BaseConnector` directly (not `BaseCraneConnector` — that's Crane-specific)
   and implements `login()`, `isLoggedIn()`, `syncBalance()`, `logout()`
   itself, however that airline's actual site works.
3. Register it in `services/ConnectorRegistry.ts` — one line, in the
   `registry` map.
4. Add a row in Admin → Airline Connectors (the settings UI already renders
   from `ConnectorRegistry.listAll()`, so a registered connector shows up
   automatically — no UI code changes needed either).

Nothing in `core/`, `scheduler/`, `services/SyncService.ts`, or any existing
Category A connector needs to change. That's the Open/Closed Principle this
framework is built around: extend by adding a class + a registry entry,
never by editing shared logic.
