import { isPaymentTagReply, parsePaymentTagReply } from "../depositTracking";

describe("deposit reply parsing", () => {
  it("accepts an airline-prefixed credited tag", () => {
    expect(parsePaymentTagReply("Arik credited")).toEqual({
      decision: "CREDITED",
      airlineOverride: "ARIK",
    });
    expect(isPaymentTagReply("Arik credited")).toBe("CREDITED");
  });

  it("accepts a plain credited tag", () => {
    expect(parsePaymentTagReply("credited")).toEqual({ decision: "CREDITED" });
  });

  it("accepts a plain not-credited tag", () => {
    expect(parsePaymentTagReply("not credited")).toEqual({ decision: "NOT_CREDITED" });
  });
});
