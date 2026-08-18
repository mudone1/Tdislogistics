/**
 * Email Management System - Scheduled Tasks
 * 
 * Handles scheduled jobs:
 * - 6:00 PM: Generate and send summary report
 * - 11:00 PM: Generate and send detailed EOD report
 * - Every 5 minutes: Check for email replies from airlines
 */

import cron from "node-cron";
import { generateSummaryReport, generateEndOfDayReport } from "./reportService";
import { checkForReplies } from "./replyMonitorService";
import { sendWhatsAppMessage } from "../integrations/whatsappIntegration";

interface ScheduledTask {
  name: string;
  schedule: string; // Cron expression
  handler: () => Promise<any>;
  enabled: boolean;
}

const tasks: ScheduledTask[] = [
  {
    name: "Summary Report (6 PM)",
    schedule: "0 18 * * *", // Every day at 6:00 PM (Lagos time)
    handler: sendSummaryReportTask,
    enabled: process.env.ENABLE_EMAIL_REPORTS !== "false",
  },
  {
    name: "EOD Report (11 PM)",
    schedule: "0 23 * * *", // Every day at 11:00 PM (Lagos time)
    handler: sendEndOfDayReportTask,
    enabled: process.env.ENABLE_EMAIL_REPORTS !== "false",
  },
  {
    name: "Check Email Replies",
    schedule: "*/5 * * * *", // Every 5 minutes
    handler: checkEmailRepliesTask,
    enabled: process.env.ENABLE_EMAIL_MONITORING !== "false",
  },
];

/**
 * Initialize all scheduled tasks
 */
export function initializeScheduledTasks(): void {
  console.log("🕐 Initializing scheduled email tasks...");

  tasks.forEach((task) => {
    if (!task.enabled) {
      console.log(`  ⏭️  ${task.name} (disabled)`);
      return;
    }

    try {
      cron.schedule(task.schedule, async () => {
        console.log(`\n📅 Running: ${task.name}`);
        try {
          const result = await task.handler();
          console.log(`  ✅ ${task.name} completed`);
          if (result?.errors) {
            console.log(`  ⚠️  Errors:`, result.errors);
          }
        } catch (error) {
          console.error(`  ❌ ${task.name} failed:`, error);
        }
      });

      console.log(`  ✅ ${task.name} scheduled (${task.schedule})`);
    } catch (error) {
      console.error(`  ❌ Failed to schedule ${task.name}:`, error);
    }
  });

  console.log("✨ All scheduled tasks initialized\n");
}

/**
 * Send summary report at 6 PM
 */
async function sendSummaryReportTask(): Promise<void> {
  try {
    const report = await generateSummaryReport();

    if (!report) {
      console.warn("No summary report generated");
      return;
    }

    // Send to WhatsApp
    const chatId = process.env.ADMIN_WHATSAPP_CHAT_ID;
    if (chatId) {
      await sendWhatsAppMessage(chatId, report.whatsappText);
    }
  } catch (error) {
    console.error("Error sending summary report:", error);
    throw error;
  }
}

/**
 * Send detailed EOD report at 11 PM
 */
async function sendEndOfDayReportTask(): Promise<void> {
  try {
    const report = await generateEndOfDayReport();

    if (!report) {
      console.warn("No EOD report generated");
      return;
    }

    // Send to WhatsApp
    const chatId = process.env.ADMIN_WHATSAPP_CHAT_ID;
    if (chatId) {
      await sendWhatsAppMessage(chatId, report.whatsappText);
    }
  } catch (error) {
    console.error("Error sending EOD report:", error);
    throw error;
  }
}

/**
 * Check for email replies every 5 minutes
 */
async function checkEmailRepliesTask(): Promise<void> {
  try {
    const result = await checkForReplies();

    if (result.updated > 0) {
      console.log(
        `  📬 Checked ${result.checked} emails, matched ${result.matched}, updated ${result.updated} cases`
      );
    }
  } catch (error) {
    console.error("Error checking email replies:", error);
    throw error;
  }
}

/**
 * Stop all scheduled tasks (for testing or graceful shutdown)
 */
export function stopScheduledTasks(): void {
  cron.getTasks().forEach((task) => task.stop());
  console.log("🛑 All scheduled tasks stopped");
}

/**
 * Get all scheduled tasks (for debugging)
 */
export function getScheduledTasks(): ScheduledTask[] {
  return tasks;
}

/**
 * Manually trigger a specific task (for testing)
 */
export async function triggerTask(taskName: string): Promise<any> {
  const task = tasks.find((t) => t.name === taskName);
  if (!task) {
    throw new Error(`Task not found: ${taskName}`);
  }

  console.log(`🚀 Manually triggering: ${taskName}`);
  return await task.handler();
}

/**
 * Check if tasks are running
 */
export function areTasksRunning(): boolean {
  return cron.getTasks().length > 0;
}
