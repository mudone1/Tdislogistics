/**
 * src/app/api/assistant/book-hold/[id]/save/route.ts
 *
 * POST /api/assistant/book-hold/{jobId}/save
 *
 * User clicks "Save PNR" after successful booking.
 * This saves the booking to their history so they can:
 * - Retrieve it later with just the PNR
 * - Issue the ticket anytime
 * - Rebook if expired
 * - Void if issued
 *
 * No payment is made — this just persists the booking record.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "firebase-admin-sdk"; // or your auth method
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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

    // Get the booking job
    const job = await prisma.bookingJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return NextResponse.json({ error: "Booking job not found" }, { status: 404 });
    }

    if (job.status !== "SUCCESS" || !job.pnr) {
      return NextResponse.json(
        { error: "Cannot save a booking that was not successful" },
        { status: 400 }
      );
    }

    // Check if this booking is already saved by this user
    const existingBooking = await prisma.userBooking.findUnique({
      where: { jobId },
    });

    if (existingBooking) {
      // Already saved — just return it
      return NextResponse.json({
        success: true,
        userBookingId: existingBooking.id,
        pnr: existingBooking.pnr,
        message: "Booking was already saved",
      });
    }

    // Save the booking to user's history
    const userBooking = await prisma.userBooking.create({
      data: {
        userId,
        jobId,
        pnr: job.pnr,
        airline: job.airline,
        status: "BOOKED",
        expiresAt: job.holdExpiresAt ? new Date(job.holdExpiresAt) : undefined,
      },
    });

    console.log(`[save-pnr] saved booking: userId=${userId}, pnr=${job.pnr}, userBookingId=${userBooking.id}`);

    return NextResponse.json({
      success: true,
      userBookingId: userBooking.id,
      pnr: userBooking.pnr,
      expiresAt: userBooking.expiresAt,
      message: `Booking ${job.pnr} has been saved. You can issue the ticket anytime by saying "Issue ${job.pnr}" or provide the PNR later.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[save-pnr] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
