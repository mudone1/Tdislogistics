// Shared types for the Airline Connector Framework.
// Kept framework-agnostic of Prisma's generated types so `core`/`interfaces`
// don't need to import the Prisma client — only `storage` does.
export class ConnectorError extends Error {
    step;
    airline;
    cause;
    constructor(message, step, airline, cause) {
        super(message);
        this.step = step;
        this.airline = airline;
        this.cause = cause;
        this.name = "ConnectorError";
    }
}
