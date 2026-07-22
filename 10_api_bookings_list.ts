/**
 * src/app/api/assistant/bookings/route.ts
 *
 * GET /api/assistant/bookings - List all user's saved bookings
 * GET /api/assistant/bookings?search=ABC123 - Search for a specific PNR
 *
 * Users can retrieve their previous bookings and perform operations on them
 * using just the PNR.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "firebase-admin-sdk";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    let userId: string;

    try {
      const decodedToken = await auth().verifyIdToken(token);
      userId = decodedToken.uid;
    } catch (err) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Check for search query
    const searchQuery = request.nextUrl.searchParams.get("search");

    let bookings;
    if (searchQuery) {
      // Search for specific PNR
      bookings = await prisma.userBooking.findMany({
        where: {
          userId,
          pnr: {
            contains: searchQuery.toUpperCase(),
          },
        },
        include: {
          job: {
            select: {
              origin: true,
              destination: true,
              departureDate: true,
              returnDate: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: {
          bookedAt: "desc",
        },
      });
    } else {
      // List all bookings
      bookings = await prisma.userBooking.findMany({
        where: { userId },
        include: {
          job: {
            select: {
              origin: true,
              destination: true,
              departureDate: true,
              returnDate: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: {
          bookedAt: "desc",
        },
        take: 50, // Limit to recent bookings
      });
    }

    // Format response
    const formattedBookings = bookings.map((booking) => ({
      id: booking.id,
      pnr: booking.pnr,
      airline: booking.airline,
      status: booking.status,
      route: booking.job
        ? `${booking.job.origin}→${booking.job.destination}`
        : "Unknown",
      departureDate: booking.job?.departureDate,
      passenger: booking.job
        ? `${booking.job.firstName} ${booking.job.lastName}`
        : "Unknown",
      bookedAt: booking.bookedAt,
      issuedAt: booking.issuedAt,
      voidedAt: booking.voidedAt,
      expiresAt: booking.expiresAt,
      actions: getAvailableActions(booking.status),
    }));

    return NextResponse.json({
      success: true,
      count: formattedBookings.length,
      bookings: formattedBookings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bookings-list] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Determine which actions are available for a booking in a given status
 */
function getAvailableActions(status: string): string[] {
  const actions = [];

  switch (status) {
    case "BOOKED":
      actions.push("issue", "rebook", "cancel");
      break;
    case "ISSUED":
      actions.push("void", "rebook");
      break;
    case "VOIDED":
      actions.push("rebook");
      break;
    case "EXPIRED":
      actions.push("rebook");
      break;
  }

  // All statuses can be checked/viewed
  actions.push("view");

  return actions;
}
