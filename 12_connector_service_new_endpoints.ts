/**
 * connector-service/src/server.ts - UPDATED
 *
 * New endpoints added:
 * - POST /internal/travel-assistant/issue-ticket - Issue a saved booking
 * - POST /internal/travel-assistant/rebook - Rebook a flight
 * - POST /internal/travel-assistant/void-ticket - Void an issued ticket
 *
 * These run Playwright automation and update BookingJob rows with results.
 */

// === ADD THESE IMPORTS ===
import { issueEnuguAirTicket } from "../../src/modules/travel-assistant/booking/enugu/EnuguIssueTicket";
import { rebookEnuguAirFlight } from "../../src/modules/travel-assistant/booking/enugu/EnuguRebook";
import { voidEnuguAirTicket } from "../../src/modules/travel-assistant/booking/enugu/EnuguVoidTicket";
import { verifyPnrExists } from "../../src/modules/travel-assistant/verification/VerifyPnr";

// === ADD THESE NEW ENDPOINTS (insert after existing book-hold endpoint) ===

/**
 * Issue a ticket for a previously booked PNR
 *
 * Request body:
 * {
 *   jobId: "uuid-of-issue-job",
 *   pnr: "ABC123",
 *   passengerLastName: "Adeniyi"
 * }
 */
app.post("/internal/travel-assistant/issue-ticket", async (req, res) => {
  const jobId = req.body?.jobId;
  const pnr = req.body?.pnr;
  const passengerLastName = req.body?.passengerLastName;

  if (!jobId || !pnr || !passengerLastName) {
    res.status(400).json({ error: "jobId, pnr, and passengerLastName are required" });
    return;
  }

  const job = await BookingJobRepository.findById(jobId);
  if (!job) {
    res.status(404).json({ error: `No booking job ${jobId}` });
    return;
  }
  if (job.status !== "PENDING") {
    res.status(409).json({ error: `Job ${jobId} is ${job.status}, not PENDING` });
    return;
  }

  const settings = await AirlineWalletRepository.getSettings(job.airline);
  if (!settings?.encryptedUsername || !settings.encryptedPassword) {
    await BookingJobRepository.markFailed(
      jobId,
      "LOGIN_FAILED",
      `No credentials configured for ${job.airline}`,
      0
    );
    res.status(502).json({ error: `No credentials configured for ${job.airline}` });
    return;
  }

  const credentials = {
    username: decryptSecret(settings.encryptedUsername),
    password: decryptSecret(settings.encryptedPassword),
  };

  console.log(`[issue-ticket] starting job=${jobId} for pnr=${pnr}`);
  await BookingJobRepository.markRunning(jobId);
  const startedAt = Date.now();
  res.status(202).json({ accepted: true, jobId });

  issueEnuguAirTicket({
    pnr,
    passengerLastName,
    credentials,
  })
    .then(async (result) => {
      const durationMs = Date.now() - startedAt;

      if (!result.success) {
        console.error(`[issue-ticket] job=${jobId} FAILED: ${result.message}`);

        const errorCategory = result.bookingExpired
          ? "UNKNOWN"
          : "UNKNOWN";

        await BookingJobRepository.markFailed(jobId, errorCategory, result.message, durationMs);
        return;
      }

      console.log(`[issue-ticket] job=${jobId} SUCCESS in ${durationMs}ms`);
      await BookingJobRepository.markSuccess(jobId, {
        pnr,
        screenshot: result.screenshot,
        durationMs,
      });
    })
    .catch(async (err) => {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[issue-ticket] job=${jobId} FAILED after ${durationMs}ms:`, message);
      await BookingJobRepository.markFailed(jobId, "UNKNOWN", message, durationMs).catch((e) => {
        console.error(`[issue-ticket] job=${jobId} could not record failure:`, e);
      });
    });
});

/**
 * Rebook a flight using saved booking details
 *
 * Request body:
 * {
 *   jobId: "uuid-of-rebook-job",
 *   originalPnr: "ABC123",
 *   credentials: { username, password },
 *   newDepartureDate?: "YYYY-MM-DD",
 *   newReturnDate?: "YYYY-MM-DD",
 *   newOrigin?: "JNB",
 *   newDestination?: "LOS"
 * }
 */
app.post("/internal/travel-assistant/rebook", async (req, res) => {
  const jobId = req.body?.jobId;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const job = await BookingJobRepository.findById(jobId);
  if (!job) {
    res.status(404).json({ error: `No booking job ${jobId}` });
    return;
  }
  if (job.status !== "PENDING") {
    res.status(409).json({ error: `Job ${jobId} is ${job.status}, not PENDING` });
    return;
  }

  const settings = await AirlineWalletRepository.getSettings(job.airline);
  if (!settings?.encryptedUsername || !settings.encryptedPassword) {
    await BookingJobRepository.markFailed(jobId, "LOGIN_FAILED", `No credentials configured`, 0);
    res.status(502).json({ error: "No credentials configured" });
    return;
  }

  const credentials = {
    username: decryptSecret(settings.encryptedUsername),
    password: decryptSecret(settings.encryptedPassword),
  };

  console.log(`[rebook] starting job=${jobId}`);
  await BookingJobRepository.markRunning(jobId);
  const startedAt = Date.now();
  res.status(202).json({ accepted: true, jobId });

  rebookEnuguAirFlight({
    originalPnr: req.body.originalPnr,
    passengerFirstName: job.firstName,
    passengerLastName: job.lastName,
    passengerTitle: job.title,
    email: job.email || "",
    phone: job.phone || "",
    origin: job.origin,
    destination: job.destination,
    departureDate: job.departureDate,
    returnDate: job.returnDate,
    newDepartureDate: req.body.newDepartureDate,
    newReturnDate: req.body.newReturnDate,
    newOrigin: req.body.newOrigin,
    newDestination: req.body.newDestination,
    fareClassPreference: ["Economy Promo", "Economy Saver"],
    credentials,
  })
    .then(async (result) => {
      const durationMs = Date.now() - startedAt;

      if (!result.success) {
        console.error(`[rebook] job=${jobId} FAILED: ${result.message}`);
        await BookingJobRepository.markFailed(jobId, "UNKNOWN", result.message, durationMs);
        return;
      }

      console.log(`[rebook] job=${jobId} SUCCESS: pnr=${result.newPnr}`);
      await BookingJobRepository.markSuccess(jobId, {
        pnr: result.newPnr || "",
        screenshot: result.screenshot,
        durationMs,
      });
    })
    .catch(async (err) => {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rebook] job=${jobId} FAILED:`, message);
      await BookingJobRepository.markFailed(jobId, "UNKNOWN", message, durationMs).catch(() => {});
    });
});

/**
 * Void an issued ticket
 *
 * Request body:
 * {
 *   jobId: "uuid-of-void-job",
 *   pnr: "ABC123",
 *   credentials: { username, password }
 * }
 */
app.post("/internal/travel-assistant/void-ticket", async (req, res) => {
  const jobId = req.body?.jobId;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const job = await BookingJobRepository.findById(jobId);
  if (!job) {
    res.status(404).json({ error: `No booking job ${jobId}` });
    return;
  }
  if (job.status !== "PENDING") {
    res.status(409).json({ error: `Job ${jobId} is ${job.status}, not PENDING` });
    return;
  }

  const settings = await AirlineWalletRepository.getSettings(job.airline);
  if (!settings?.encryptedUsername || !settings.encryptedPassword) {
    await BookingJobRepository.markFailed(jobId, "LOGIN_FAILED", `No credentials configured`, 0);
    res.status(502).json({ error: "No credentials configured" });
    return;
  }

  const credentials = {
    username: decryptSecret(settings.encryptedUsername),
    password: decryptSecret(settings.encryptedPassword),
  };

  console.log(`[void-ticket] starting job=${jobId} for pnr=${req.body.pnr}`);
  await BookingJobRepository.markRunning(jobId);
  const startedAt = Date.now();
  res.status(202).json({ accepted: true, jobId });

  voidEnuguAirTicket({
    pnr: req.body.pnr,
    passengerLastName: job.lastName,
    credentials,
  })
    .then(async (result) => {
      const durationMs = Date.now() - startedAt;

      if (!result.success) {
        console.error(`[void-ticket] job=${jobId} FAILED: ${result.message}`);
        await BookingJobRepository.markFailed(jobId, "UNKNOWN", result.message, durationMs);
        return;
      }

      console.log(`[void-ticket] job=${jobId} SUCCESS`);
      await BookingJobRepository.markSuccess(jobId, {
        pnr: req.body.pnr,
        screenshot: result.screenshot,
        durationMs,
      });
    })
    .catch(async (err) => {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[void-ticket] job=${jobId} FAILED:`, message);
      await BookingJobRepository.markFailed(jobId, "UNKNOWN", message, durationMs).catch(() => {});
    });
});
