"use client";

import Image from "next/image";
import { AIRLINE_LOGO_MAP, AIRLINES } from "@/lib/constants";
import {
  formatNaira,
  formatTime12h,
  shortCabinClass,
  cheapestFareClassName,
  cheapestFareClass,
  cheapestPerAirline,
} from "@/modules/travel-assistant/formatting/formatFlightResults";
import type { FlightSearchResult } from "@/modules/travel-assistant/core/types";

export interface FlightLeg {
  label: string;
  result: FlightSearchResult;
}

// FlightOption.airline uses each search module's own display label
// ("Enugu Air", "United Nigeria", "XeJet", "Rano Air"), which doesn't
// always match AIRLINES' `name` field exactly (e.g. "XeJet" vs "XE
// Jet") — normalize both sides before comparing instead of requiring an
// exact string match.
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function logoFor(airlineName: string): string | null {
  const match = AIRLINES.find((a) => normalize(a.name) === normalize(airlineName));
  return match ? AIRLINE_LOGO_MAP[match.code] ?? null : null;
}

// Fares aren't held/guaranteed — flag the quote as time-bound rather than
// implying it's a locked-in price.
const VALIDITY_HOURS = 24;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function formatValidUntil(searchedAt: string): string {
  return formatDateTime(new Date(new Date(searchedAt).getTime() + VALIDITY_HOURS * 60 * 60 * 1000).toISOString());
}

export default function FlightCards({ legs }: { legs: FlightLeg[] }) {
  const generatedAt = legs[0]?.result.searchedAt ?? new Date().toISOString();

  return (
    <div className="quote-card">
      <div className="quote-card-header">
        <Image
          src="/images/Tdis_logo.jpeg"
          alt="TDIS Logistics"
          width={72}
          height={37}
          className="quote-card-logo"
        />
        <div className="quote-card-header-text">
          <div className="quote-card-title">Flight Quote</div>
          <div className="quote-card-generated">Generated {formatDateTime(generatedAt)}</div>
        </div>
      </div>

      {legs.map((leg, i) => (
        <div key={i} className="quote-card-leg">
          <div className="quote-card-route-row">
            {leg.label && <span className="quote-card-leg-label">{leg.label}</span>}
            <span className="quote-card-route">
              {leg.result.query.origin} → {leg.result.query.destination}
            </span>
            <span className="quote-card-date">{leg.result.query.date}</span>
          </div>

          {leg.result.options.length === 0 ? (
            <div className="quote-card-empty">No flights found for this leg</div>
          ) : (
            <div className="quote-card-rows">
              {cheapestPerAirline(leg.result.options).map((option, j) => {
                const logo = logoFor(option.airline);
                const fareClass = cheapestFareClass(option);
                return (
                  <div key={j} className="quote-card-row">
                    <div className="quote-card-row-airline">
                      {logo ? (
                        // Airline logos are third-party brand marks, kept as
                        // plain <img> like AirlinesSection.tsx's convention.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt={option.airline} className="quote-card-row-logo" />
                      ) : (
                        <div className="quote-card-row-logo quote-card-row-logo-fallback">
                          {option.airline.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="quote-card-row-airline-name">{option.airline}</div>
                        <div className="quote-card-row-time">{formatTime12h(option.departureTime)}</div>
                      </div>
                    </div>

                    <div className="quote-card-row-fare">
                      <span className="quote-card-row-price">
                        {option.fare != null ? formatNaira(option.fare) : option.seatStatus ?? "Unavailable"}
                      </span>
                      <span className="quote-card-row-cabin">{shortCabinClass(cheapestFareClassName(option))}</span>
                    </div>

                    <div className="quote-card-row-details">
                      <span>{fareClass?.baggage ?? "Baggage info unavailable"}</span>
                      <span>{fareClass?.refundPolicy ?? "Fare condition unavailable"}</span>
                      <span>
                        {fareClass?.seatsLeft != null
                          ? `${fareClass.seatsLeft} seat${fareClass.seatsLeft === 1 ? "" : "s"} left`
                          : option.fare != null
                            ? "Available"
                            : "Sold out"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div className="quote-card-footer">
        Quote valid until {formatValidUntil(generatedAt)} — fares subject to change without notice.
      </div>
    </div>
  );
}
