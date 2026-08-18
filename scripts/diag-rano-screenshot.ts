import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

async function main() {
  const job = await prisma.bookingJob.findFirst({
    where: { airline: "RANO", status: "FAILED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, errorMessage: true },
  });
  if (!job) {
    console.log("No failed RANO job found");
    return;
  }
  console.log("job:", job.id, job.createdAt.toISOString());
  const msg = job.errorMessage ?? "";
  const marker = "DIAGSHOT_BASE64_JPEG:";
  const idx = msg.indexOf(marker);
  if (idx === -1) {
    console.log("No diagnostic screenshot found in this job's error message.");
    console.log("Full message:", msg);
    return;
  }
  const base64 = msg.slice(idx + marker.length).trim();
  const buf = Buffer.from(base64, "base64");
  const outPath = "C:/Users/USER/AppData/Local/Temp/claude/C--Users-USER-Desktop-TDIS/1c5a834a-3a03-41bc-a2cc-cd916b5abc45/scratchpad/rano-2pax-diag.jpg";
  fs.writeFileSync(outPath, buf);
  console.log("Wrote screenshot to:", outPath, "size:", buf.length);
  console.log("Message before screenshot marker:", msg.slice(0, idx));
}

main().finally(() => prisma.$disconnect());
