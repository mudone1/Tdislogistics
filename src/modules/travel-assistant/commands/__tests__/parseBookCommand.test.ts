import { describe, it, expect } from "@jest/globals";
import { parseBookCommand, isBookCommand } from "../parseBookCommand";

describe("isBookCommand", () => {
  it("matches a message starting with /book (case-insensitive)", () => {
    expect(isBookCommand("/book\nAirline: Enugu")).toBe(true);
    expect(isBookCommand("/BOOK\nAirline: Enugu")).toBe(true);
    expect(isBookCommand("  /book  \nAirline: Enugu")).toBe(true);
  });

  it("does not match plain free-text booking messages", () => {
    expect(isBookCommand("Book Enugu for John Doe")).toBe(false);
    expect(isBookCommand("hold a flight please")).toBe(false);
  });
});

describe("parseBookCommand", () => {
  it("parses a single adult, one-way booking", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: Enugu",
        "Route: LOS-ABV",
        "Date: 20 Aug",
        "A: Mr John Doe",
        "Phone: 08012345678",
        "Email: john.doe@example.com",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    expect(result.turn?.intent).toBe("BOOK_ON_HOLD");
    expect(result.turn?.entities.airline).toBe("ENUGU");
    expect(result.turn?.entities.origin).toBe("LOS");
    expect(result.turn?.entities.destination).toBe("ABV");
    expect(result.turn?.entities.passengerTitle).toBe("Mr");
    expect(result.turn?.entities.passengerFullName).toBe("John Doe");
    expect(result.turn?.entities.passengerPhone).toBe("08012345678");
    expect(result.turn?.entities.passengerEmail).toBe("john.doe@example.com");
    expect(result.turn?.entities.returnDate).toBeNull();
    expect(result.turn?.entities.additionalPassengers).toBeNull();
  });

  it("parses 2 adults + 1 child + 1 infant with explicit numbering and DOBs", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: XeJet",
        "Route: Lagos to Kano",
        "Date: 25 Aug",
        "A1: Mr John Doe",
        "A2: Mrs Jane Doe",
        "C1: Miss Amaka Doe, DOB 12 Jan 2019",
        "I1: Master Ade Doe, DOB 03 Mar 2025",
        "Phone: 08012345678",
        "Email: john.doe@example.com",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    expect(result.turn?.entities.airline).toBe("XEJET");
    expect(result.turn?.entities.passengerFullName).toBe("John Doe");
    const additional = result.turn?.entities.additionalPassengers ?? [];
    expect(additional).toHaveLength(3);
    expect(additional[0]).toMatchObject({ fullName: "Jane Doe", type: "ADULT" });
    expect(additional[1]).toMatchObject({ fullName: "Amaka Doe", type: "CHILD", title: "Miss" });
    expect(additional[1]?.dateOfBirth).toBeTruthy();
    expect(additional[2]).toMatchObject({ type: "INFANT" });
    expect(additional[2]?.dateOfBirth).toBeTruthy();
  });

  it("parses a round trip with a Return field", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: United",
        "Route: ABV-LOS",
        "Date: 20 Aug",
        "Return: 25 Aug",
        "A: Dr Grace Okonkwo",
        "Phone: 08099887766",
        "Email: grace.okonkwo@example.com",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    expect(result.turn?.entities.returnDate).toBeTruthy();
    expect(result.turn?.entities.passengerTitle).toBe("Dr");
  });

  it("reports every missing/invalid field at once for a malformed command", () => {
    const result = parseBookCommand(
      ["/book", "Airline: Rano", "Route: PHC-LOS", "A1: Mr Musa Bello", "A2: Ibrahim Bello", "Phone: 12345"].join("\n")
    );

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("Date is missing");
    expect(result.reply).toContain("Email is missing");
    expect(result.reply).toContain("doesn't look valid");
  });

  it("rejects an unrecognized airline", () => {
    const result = parseBookCommand(
      ["/book", "Airline: FakeAir", "Route: LOS-ABV", "Date: 20 Aug", "A: Mr John Doe", "Phone: 08012345678", "Email: a@b.com"].join(
        "\n"
      )
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("isn't an airline I can book");
  });

  it("rejects an unrecognized route", () => {
    const result = parseBookCommand(
      ["/book", "Airline: Enugu", "Route: nonsense text", "Date: 20 Aug", "A: Mr John Doe", "Phone: 08012345678", "Email: a@b.com"].join(
        "\n"
      )
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("couldn't recognize a route");
  });

  it("requires a distinct number for each of 2+ passengers of the same type", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: Enugu",
        "Route: LOS-ABV",
        "Date: 20 Aug",
        "A: Mr John Doe",
        "A: Mrs Jane Doe",
        "Phone: 08012345678",
        "Email: a@b.com",
      ].join("\n")
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("each needs its own number");
  });

  it("requires a date of birth for a child passenger", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: Enugu",
        "Route: LOS-ABV",
        "Date: 20 Aug",
        "A: Mr John Doe",
        "C1: Miss Amaka Doe",
        "Phone: 08012345678",
        "Email: a@b.com",
      ].join("\n")
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("needs a date of birth");
  });

  it("requires the first passenger to be an adult", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: Enugu",
        "Route: LOS-ABV",
        "Date: 20 Aug",
        "C1: Miss Amaka Doe, DOB 12 Jan 2019",
        "Phone: 08012345678",
        "Email: a@b.com",
      ].join("\n")
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("must be an adult");
  });

  it("rejects an invalid phone number", () => {
    const result = parseBookCommand(
      ["/book", "Airline: Enugu", "Route: LOS-ABV", "Date: 20 Aug", "A: Mr John Doe", "Phone: 123", "Email: a@b.com"].join("\n")
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("doesn't look valid");
  });

  it("rejects an invalid email", () => {
    const result = parseBookCommand(
      ["/book", "Airline: Enugu", "Route: LOS-ABV", "Date: 20 Aug", "A: Mr John Doe", "Phone: 08012345678", "Email: not-an-email"].join(
        "\n"
      )
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("doesn't look like a valid email");
  });

  it("flags an unrecognized line instead of silently dropping it", () => {
    const result = parseBookCommand(
      [
        "/book",
        "Airline: Enugu",
        "Rout: LOS-ABV",
        "Date: 20 Aug",
        "A: Mr John Doe",
        "Phone: 08012345678",
        "Email: a@b.com",
      ].join("\n")
    );
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("Route is missing");
    expect(result.reply).toContain('I didn\'t recognize this line');
  });
});
