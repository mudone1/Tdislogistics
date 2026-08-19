import type { AirlineKey } from "@prisma/client";
import { isPaystackReceipt, matchAirlineFromReceipt } from "./depositAirlineAliases";
import type { PaymentReceiptParseResult } from "./PaymentReceiptParser";

export function resolveAirlineForTag(
  extraction: PaymentReceiptParseResult,
  airlineOverride?: AirlineKey,
  isPaystack: boolean = isPaystackReceipt(extraction.narration, extraction.beneficiary, extraction.bankChannel)
): AirlineKey | null {
  if (isPaystack) return null;
  return airlineOverride ?? matchAirlineFromReceipt(extraction.narration, extraction.beneficiary);
}
