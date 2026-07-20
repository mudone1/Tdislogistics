"use client";

import { useState } from "react";
import { AIRLINE_LOGO_MAP, AIRLINES } from "@/lib/constants";
import {
  formatNaira,
  formatTime12h,
  shortCabinClass,
  cheapestFareClassName,
  formatSingleFlight,
} from "@/modules/travel-assistant/formatting/formatFlightResults";
import type { FlightOption, FlightSearchResult } from "@/modules/travel-assistant/core/types";

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

export default function FlightCards({ legs }: { legs: FlightLeg[] }) {
  return (
    <div className="flight-cards">
      {legs.map((leg, i) => (
        <div key={i} className="flight-cards-leg">
          {leg.label && <div className="flight-cards-leg-label">{leg.label}</div>}
          <div className="flight-cards-grid">
            {leg.result.options.map((option, j) => (
              <FlightCard key={j} option={option} leg={leg} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FlightCard({ option, leg }: { option: FlightOption; leg: FlightLeg }) {
  const [copied, setCopied] = useState(false);
  const logo = logoFor(option.airline);
  const cabin = shortCabinClass(cheapestFareClassName(option));

  async function copyCard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        formatSingleFlight(option, leg.result.query.origin, leg.result.query.destination, leg.result.query.date)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[assistant] card copy failed:", err);
    }
  }

  function shareCard(): void {
    const text = formatSingleFlight(option, leg.result.query.origin, leg.result.query.destination, leg.result.query.date);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flight-card">
      <div className="flight-card-header">
        {logo ? (
          // Airline logos are third-party brand marks — kept as plain <img>,
          // matching AirlinesSection.tsx's convention (small static SVGs
          // don't need next/image's optimizer).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={option.airline} className="flight-card-logo" />
        ) : (
          <div className="flight-card-logo flight-card-logo-fallback">{option.airline.slice(0, 2).toUpperCase()}</div>
        )}
        <span className="flight-card-airline">{option.airline}</span>
      </div>

      <div className="flight-card-route">
        {leg.result.query.origin} → {leg.result.query.destination}
      </div>

      <div className="flight-card-body">
        <span className="flight-card-time">{formatTime12h(option.departureTime)}</span>
        <span className="flight-card-cabin">{cabin}</span>
      </div>

      <div className="flight-card-price">
        {option.fare != null ? formatNaira(option.fare) : option.seatStatus ?? "unavailable"}
      </div>

      <div className="flight-card-actions">
        <button onClick={copyCard}>{copied ? "✓ Copied" : "📋 Copy"}</button>
        <button onClick={shareCard}>Share to WhatsApp</button>
      </div>
    </div>
  );
}
