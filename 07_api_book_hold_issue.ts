/**
 * src/app/api/assistant/book-hold/[id]/issue/route.ts
 *
 * POST /api/assistant/book-hold/{jobId}/issue
 * POST /api/assistant/bookings/{pnr}/issue
 *
 * User clicks "Issue Now" to complete payment for a saved booking.
 *
 * This workflow:
 * 1. Creates a new BookingJob for the payment/issuance
 * 2. Sends it to connector-service for automation
 * 3. Returns a job ID for polling
 *
 * The user polls /api/assistant/book-hold/{newJobId} until status is SUCCESS or FAILED
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "firebase-admin-sdk";
import { prisma } from "@/lib/prisma";
import { getUserCredential } from "@/modules/airline-connectors/services/UserCredentialService";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const jobId = params.id;

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

    // Get the original booking job
    const originalJob = await prisma.bookingJob.findUnique({
      where: { id: jobId },
    });

    if (!originalJob) {
      return NextResponse.json({ error: "Booking job not found" }, { status: 404 });
    }

    if (originalJob.status !== "SUCCESS" || !originalJob.pnr) {
      return NextResponse.json(
        { error: "Cannot issue a booking that was not successfully created" },
        { status: 400 }
      );
    }

    // Check that user owns this booking
    const userBooking = await prisma.userBooking.findUnique({
      where: { jobId },
    });

    if (!userBooking || userBooking.userId !== userId) {
      return NextResponse.json(
        { error: "You do not have access to this booking" },
        { status: 403 }
      );
    }

    // Check if user has credentials saved for this airline
    const userCredentials = await getUserCredential(userId, originalJob.airline);
    if (!userCredentials) {
      return NextResponse.json(
        {
          error: "No credentials saved for this airline",
          action: "saveCredentials",
          airline: originalJob.airline,
          message: `Please save your ${originalJob.airline} account credentials first`,
        },
        { status: 400 }
      );
    }

    // Create a new BookingJob for the issuance/payment step
    const issueJob = await prisma.bookingJob.create({
      data: {
        status: "PENDING",
        airline: originalJob.airline,
        userId,
        sessionKey: originalJob.sessionKey,
        
        // Reuse original booking details
        origin: originalJob.origin,
        destination: originalJob.destination,
        departureDate: originalJob.departureDate,
        returnDate: originalJob.returnDate,
        title: originalJob.title,
        firstName: originalJob.firstName,
        lastName: originalJob.lastName,
        phone: originalJob.phone,
        email: originalJob.email,
      },
    });

    // Store reference to the issue job in user booking
    await prisma.userBooking.update({
      where: { id: userBooking.id },
      data: { issueJobId: issueJob.id },
    });

    console.log(
      `[issue-now] created issue job: pnr=${originalJob.pnr}, issueJobId=${issueJob.id}`
    );

    // Send to connector-service
    try {
      const connectorResponse = await fetch(
        `${process.env.CONNECTOR_SERVICE_URL}/internal/travel-assistant/issue-ticket`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-api-key": process.env.CONNECTOR_SERVICE_API_KEY || "",
          },
          body: JSON.stringify({
            jobId: issueJob.id,
            pnr: originalJob.pnr,
            passengerLastName: originalJob.lastName,
          }),
        }
      );

      if (!connectorResponse.ok) {
        console.error("[issue-now] connector error:", connectorResponse.status);
      }
    } catch (connectorErr) {
      console.error("[issue-now] failed to send to connector-service:", connectorErr);
      // Don't fail — the job is created and connector will pick it up
    }

    return NextResponse.json({
      success: true,
      jobId: issueJob.id,
      pnr: originalJob.pnr,
      message: "Payment process has started. Please wait while we complete your ticket issuance...",
      pollUrl: `/api/assistant/book-hold/${issueJob.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[issue-now] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
