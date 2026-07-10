/**
 * Bridges the connector framework's AirlineKey enum to the display names
 * already used throughout the existing app (src/lib/constants.ts ->
 * AIRLINES, and every Balance.airline value in Firestore). Keeping this in
 * one place means the mirror write to Firestore always lines up with what
 * the dashboard already expects, with no risk of a typo'd string drifting
 * between the two systems.
 */
export const AIRLINE_KEY_TO_DISPLAY_NAME = {
    AIRPEACE: "Air Peace",
    AERO: "Aero Contractors",
    ARIK: "Arik Air",
    IBOM: "Ibom Air",
    NGEAGLE: "NG Eagle",
};
export function airlineKeyToDisplayName(key) {
    return AIRLINE_KEY_TO_DISPLAY_NAME[key];
}
