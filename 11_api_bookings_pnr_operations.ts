/**
 * src/app/api/assistant/bookings/[pnr]/operations/route.ts
 *
 * POST /api/assistant/bookings/{pnr}/rebook - Rebook a booking
 * POST /api/assistant/bookings/{pnr}/void - Void an issued ticket
 * POST /api/assistant/bookings/{pnr}/check-status - Check booking status
 *
 * Users can perform operations on bookings using just the PNR.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "firebase-admin-sdk";
import { prisma } from "@/lib/prisma";
import { getUserCredential } from "@/modules/airline-connectors/services/UserCredentialService";
import { rebookEnuguAirFlight } from "@/modules/travel-assistant/booking/enugu/EnuguRebook";
import { voidEnuguAirTicket } from "@/modules/travel-assistant/booking/enugu/EnuguVoidTicket";
import { verifyPnrExists } from "@/modules/travel-assistant/verification/VerifyPnr";

export async function POST(
  request: NextRequest,
  { params }: { params: { pnr: string } }
) {
  const pnr = params.pnr.toUpperCase();

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

    const body = await request.json();
    const operation = body.operation; // "rebook" | "void" | "check-status"

    // Find the booking
    const userBooking = await prisma.userBooking.findFirst({
      where: {
        userId,
        pnr,
      },
      include: {
        job: true,
      },
    });

    if (!userBooking || !userBooking.job) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Get user's credentials for this airline
    const userCredentials = await getUserCredential(userId, userBooking.airline);
    if (!userCredentials) {
      return NextResponse.json(
        {
          error: "No credentials saved for this airline",
          action: "saveCredentials",
        },
        { status: 400 }
      );
    }

    // Route to appropriate operation
    if (operation === "rebook") {
      return handleRebook(userBooking, body, userCredentials);
    } else if (operation === "void") {
      return handleVoid(userBooking, userCredentials);
    } else if (operation === "check-status") {
      return handleCheckStatus(userBooking, userCredentials);
    } else {
      return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bookings-operations] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle rebook operation
 */
async function handleRebook(
  userBooking: any,
  body: any,
  credentials: any
) {
  const job = userBooking.job;

  // Create rebook job
  const rebookJob = await prisma.bookingJob.create({
    data: {
      status: "PENDING",
      airline: userBooking.airline,
      userId: userBooking.userId,
      origin: body.newOrigin || job.origin,
      destination: body.newDestination || job.destination,
      departureDate: body.newDepartureDate || job.departureDate,
      returnDate: body.newReturnDate || job.returnDate,
      title: job.title,
      firstName: job.firstName,
      lastName: job.lastName,
      phone: job.phone,
      email: job.email,
    },
  });

  // Send to connector-service
  try {
    await fetch(
      `${process.env.CONNECTOR_SERVICE_URL}/internal/travel-assistant/rebook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": process.env.CONNECTOR_SERVICE_API_KEY || "",
        },
        body: JSON.stringify({
          jobId: rebookJob.id,
          originalPnr: userBooking.pnr,
          credentials,
          newDepartureDate: body.newDepartureDate,
          newReturnDate: body.newReturnDate,
          newOrigin: body.newOrigin,
          newDestination: body.newDestination,
        }),
      }
    );
  } catch (err) {
    console.error("[rebook] connector error:", err);
  }

  return NextResponse.json({
    success: true,
    jobId: rebookJob.id,
    message: "Rebooking process has started...",
    pollUrl: `/api/assistant/book-hold/${rebookJob.id}`,
  });
}

/**
 * Handle void operation
 */
async function handleVoid(userBooking: any, credentials: any) {
  if (userBooking.status !== "ISSUED") {
    return NextResponse.json(
      { error: "Only issued tickets can be voided" },
      { status: 400 }
    );
  }

  // Create void job
  const voidJob = await prisma.bookingJob.create({
    data: {
      status: "PENDING",
      airline: userBooking.airline,
      userId: userBooking.userId,
      origin: userBooking.job.origin,
      destination: userBooking.job.destination,
      departureDate: userBooking.job.departureDate,
      returnDate: userBooking.job.returnDate,
      title: userBooking.job.title,
      firstName: userBooking.job.firstName,
      lastName: userBooking.job.lastName,
    },
  });

  // Update user booking to track void job
  await prisma.userBooking.update({
    where: { id: userBooking.id },
    data: { voidJobId: voidJob.id },
  });

  // Send to connector-service
  try {
    await fetch(
      `${process.env.CONNECTOR_SERVICE_URL}/internal/travel-assistant/void-ticket`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": process.env.CONNECTOR_SERVICE_API_KEY || "",
        },
        body: JSON.stringify({
          jobId: voidJob.id,
          pnr: userBooking.pnr,
          credentials,
        }),
      }
    );
  } catch (err) {
    console.error("[void] connector error:", err);
  }

  return NextResponse.json({
    success: true,
    jobId: voidJob.id,
    message: "Void process has started...",
    pollUrl: `/api/assistant/book-hold/${voidJob.id}`,
  });
}

/**
 * Handle check-status operation
 */
async function handleCheckStatus(userBooking: any, credentials: any) {
  // Verify booking still exists in airline system
  const verification = await verifyPnrExists({
    pnr: userBooking.pnr,
    passengerLastName: userBooking.job.lastName,
    credentials,
  });

  return NextResponse.json({
    pnr: userBooking.pnr,
    status: userBooking.status,
    airline: userBooking.airline,
    verified: verification.verified,
    verificationMessage: verification.message,
    holdExpiresAt: userBooking.expiresAt,
    issuedAt: userBooking.issuedAt,
    voidedAt: userBooking.voidedAt,
    availableActions: getAvailableActions(userBooking.status),
  });
}

function getAvailableActions(status: string): string[] {
  const actions = [];
  switch (status) {
    case "BOOKED":
      actions.push("issue", "rebook");
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
  actions.push("check-status");
  return actions;
}
