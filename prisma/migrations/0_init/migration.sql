-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AirlineKey" AS ENUM ('AIRPEACE', 'AERO', 'ARIK', 'IBOM', 'NGEAGLE', 'UNITED', 'RANO', 'ENUGU', 'XEJET');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'IN_PROGRESS', 'PENDING');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('AUTH', 'NETWORK', 'PORTAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "SalesReportStatus" AS ENUM ('PENDING_VERIFICATION', 'SAVED');

-- CreateEnum
CREATE TYPE "BookingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingErrorCategory" AS ENUM ('LOGIN_FAILED', 'SESSION_EXPIRED', 'PORTAL_UNAVAILABLE', 'SEAT_UNAVAILABLE', 'INVALID_PASSENGER', 'ROUTE_NOT_SERVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('BOOKED', 'ISSUED', 'VOIDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "airline_wallets" (
    "id" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "previousBalance" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "lastSynced" TIMESTAMP(3),
    "lastStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastRunId" TEXT,
    "lastSuccessfulSync" TIMESTAMP(3),
    "lastFailedSync" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airline_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airline_balance_history" (
    "id" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "previousBalance" DECIMAL(14,2),
    "balanceChange" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "runId" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" "SyncStatus" NOT NULL,
    "connector" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL DEFAULT 'MANUAL',
    "durationMs" INTEGER,
    "errorCategory" "ErrorCategory",
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "initiatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airline_balance_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airline_connector_settings" (
    "id" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "encryptedUsername" TEXT,
    "encryptedPassword" TEXT,
    "syncIntervalMinutes" INTEGER,
    "dailyRunAtUtc" TEXT,
    "authFailureCount" INTEGER DEFAULT 0,
    "authFailureSince" TIMESTAMP(3),
    "authCooldownUntil" TIMESTAMP(3),
    "passwordUpdatedAt" TIMESTAMP(3),
    "maxRetryAttempts" INTEGER NOT NULL DEFAULT 3,
    "baseRetryDelayMs" INTEGER NOT NULL DEFAULT 1000,
    "syncTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "maxConcurrentSyncs" INTEGER NOT NULL DEFAULT 3,
    "authCooldownMinutes" INTEGER NOT NULL DEFAULT 300,
    "networkErrorBackoffMinutes" INTEGER NOT NULL DEFAULT 5,
    "portalErrorBackoffMinutes" INTEGER NOT NULL DEFAULT 30,
    "connectionStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airline_connector_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airline_sync_logs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "airline" "AirlineKey",
    "step" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "errorCategory" "ErrorCategory",
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airline_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airline_sync_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "initiatedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "totalAirlines" INTEGER NOT NULL,
    "successfulCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "authFailureCount" INTEGER NOT NULL DEFAULT 0,
    "networkFailureCount" INTEGER NOT NULL DEFAULT 0,
    "portalFailureCount" INTEGER NOT NULL DEFAULT 0,
    "unknownFailureCount" INTEGER NOT NULL DEFAULT 0,
    "parallelism" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airline_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "displayName" TEXT,
    "isAuthenticated" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "slots" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "entities" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_search_records" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "airlines" TEXT[],
    "resultCount" INTEGER NOT NULL,
    "resultsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_search_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notifications" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_aliases" (
    "id" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_reports" (
    "id" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "reportDate" TEXT NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reportText" TEXT NOT NULL,
    "sourceFiles" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "createdBy" TEXT,
    "verifiedBy" TEXT,
    "status" "SalesReportStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "airlineDetectedBy" TEXT,
    "detectionConfidence" DOUBLE PRECISION,
    "detectionReasoning" TEXT[],
    "fileHash" TEXT,
    "originalFilename" TEXT,
    "fileSize" INTEGER,
    "importedAt" TIMESTAMP(3),
    "importedBy" TEXT,
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededBy" TEXT,

    CONSTRAINT "sales_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sales" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transactionCount" INTEGER NOT NULL,

    CONSTRAINT "staff_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_transactions" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentType" TEXT NOT NULL,
    "mcoReference" TEXT,
    "pnr" TEXT,
    "user" TEXT NOT NULL,
    "rawRecord" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "sales_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_tickets" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "date" TEXT NOT NULL,
    "staff" TEXT NOT NULL,
    "pnr" TEXT,
    "mcoReference" TEXT,
    "ticketValue" DECIMAL(14,2) NOT NULL,
    "paymentType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL,
    "reasonIfExcluded" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grossSalesAmount" DECIMAL(14,2),
    "netSalesAmount" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "refundAmount" DECIMAL(14,2),
    "admAmount" DECIMAL(14,2),
    "bspAmount" DECIMAL(14,2),

    CONSTRAINT "sales_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_report_analytics" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "reportDate" TEXT NOT NULL,
    "reportingPeriod" TEXT,
    "reportingPeriodStart" TEXT,
    "reportingPeriodEnd" TEXT,
    "totalTicketsIssued" INTEGER NOT NULL,
    "totalTicketsVoided" INTEGER NOT NULL,
    "totalVoidAmount" DECIMAL(14,2) NOT NULL,
    "totalCreditAmount" DECIMAL(14,2) NOT NULL,
    "totalDebitAmount" DECIMAL(14,2) NOT NULL,
    "grossSalesAmount" DECIMAL(14,2) NOT NULL,
    "netSalesAmount" DECIMAL(14,2) NOT NULL,
    "totalCommission" DECIMAL(14,2) NOT NULL,
    "bspValues" DECIMAL(14,2),
    "refundValues" DECIMAL(14,2),
    "admValues" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_report_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_duplicate_history" (
    "id" TEXT NOT NULL,
    "originalReportId" TEXT NOT NULL,
    "supersededById" TEXT,
    "airline" "AirlineKey" NOT NULL,
    "reportDate" TEXT NOT NULL,
    "originalStatus" "SalesReportStatus" NOT NULL,
    "replacedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "replacementReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_duplicate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_daily_performance" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "staffName" TEXT NOT NULL,
    "ticketsIssued" INTEGER NOT NULL,
    "salesAmount" DECIMAL(14,2) NOT NULL,
    "commission" DECIMAL(14,2) NOT NULL,
    "voidAmount" DECIMAL(14,2) NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_daily_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airline_daily_metrics" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "totalSales" DECIMAL(14,2) NOT NULL,
    "totalTickets" INTEGER NOT NULL,
    "totalVoids" INTEGER NOT NULL,
    "totalVoidAmount" DECIMAL(14,2) NOT NULL,
    "netSales" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airline_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_jobs" (
    "id" TEXT NOT NULL,
    "status" "BookingJobStatus" NOT NULL DEFAULT 'PENDING',
    "airline" "AirlineKey" NOT NULL,
    "sessionKey" TEXT,
    "userId" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departureDate" TEXT NOT NULL,
    "returnDate" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Mr',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "pnr" TEXT,
    "holdExpiresAt" TEXT,
    "totalPayable" DECIMAL(14,2),
    "currency" TEXT,
    "screenshot" BYTEA,
    "pdf" BYTEA,
    "errorCategory" "BookingErrorCategory",
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "booking_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_airline_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "encryptedUsername" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "connectionStatus" TEXT NOT NULL DEFAULT 'CONFIGURED',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_airline_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_bookings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "pnr" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'BOOKED',
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "issueJobId" TEXT,
    "voidJobId" TEXT,

    CONSTRAINT "user_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnr_verifications" (
    "id" TEXT NOT NULL,
    "pnr" TEXT NOT NULL,
    "airline" "AirlineKey" NOT NULL,
    "passengerName" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMessage" TEXT,
    "verificationMs" INTEGER,

    CONSTRAINT "pnr_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airline_wallets_airline_key" ON "airline_wallets"("airline");

-- CreateIndex
CREATE INDEX "airline_balance_history_airline_retrievedAt_idx" ON "airline_balance_history"("airline", "retrievedAt");

-- CreateIndex
CREATE INDEX "airline_balance_history_runId_idx" ON "airline_balance_history"("runId");

-- CreateIndex
CREATE INDEX "airline_balance_history_syncStatus_idx" ON "airline_balance_history"("syncStatus");

-- CreateIndex
CREATE INDEX "airline_balance_history_errorCategory_idx" ON "airline_balance_history"("errorCategory");

-- CreateIndex
CREATE UNIQUE INDEX "airline_connector_settings_airline_key" ON "airline_connector_settings"("airline");

-- CreateIndex
CREATE INDEX "airline_sync_logs_airline_runId_idx" ON "airline_sync_logs"("airline", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "airline_sync_runs_runId_key" ON "airline_sync_runs"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "app_config_module_key_key" ON "app_config"("module", "key");

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_sessionKey_key" ON "chat_sessions"("sessionKey");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_createdAt_idx" ON "chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "flight_search_records_referenceId_key" ON "flight_search_records"("referenceId");

-- CreateIndex
CREATE INDEX "flight_search_records_sessionId_createdAt_idx" ON "flight_search_records"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "app_notifications_sessionId_createdAt_idx" ON "app_notifications"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_aliases_rawCode_key" ON "staff_aliases"("rawCode");

-- CreateIndex
CREATE INDEX "sales_reports_airline_reportDate_status_idx" ON "sales_reports"("airline", "reportDate", "status");

-- CreateIndex
CREATE INDEX "sales_reports_fileHash_idx" ON "sales_reports"("fileHash");

-- CreateIndex
CREATE INDEX "sales_reports_importedAt_idx" ON "sales_reports"("importedAt");

-- CreateIndex
CREATE INDEX "sales_reports_supersededById_idx" ON "sales_reports"("supersededById");

-- CreateIndex
CREATE INDEX "staff_sales_reportId_idx" ON "staff_sales"("reportId");

-- CreateIndex
CREATE INDEX "sales_transactions_reportId_idx" ON "sales_transactions"("reportId");

-- CreateIndex
CREATE INDEX "sales_tickets_airline_date_idx" ON "sales_tickets"("airline", "date");

-- CreateIndex
CREATE INDEX "sales_tickets_staff_idx" ON "sales_tickets"("staff");

-- CreateIndex
CREATE INDEX "sales_tickets_reportId_idx" ON "sales_tickets"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_report_analytics_reportId_key" ON "sales_report_analytics"("reportId");

-- CreateIndex
CREATE INDEX "sales_report_analytics_airline_reportDate_idx" ON "sales_report_analytics"("airline", "reportDate");

-- CreateIndex
CREATE INDEX "sales_report_analytics_airline_reportingPeriodStart_reporti_idx" ON "sales_report_analytics"("airline", "reportingPeriodStart", "reportingPeriodEnd");

-- CreateIndex
CREATE INDEX "report_duplicate_history_airline_reportDate_idx" ON "report_duplicate_history"("airline", "reportDate");

-- CreateIndex
CREATE INDEX "report_duplicate_history_originalReportId_idx" ON "report_duplicate_history"("originalReportId");

-- CreateIndex
CREATE INDEX "report_duplicate_history_supersededById_idx" ON "report_duplicate_history"("supersededById");

-- CreateIndex
CREATE INDEX "staff_daily_performance_airline_date_idx" ON "staff_daily_performance"("airline", "date");

-- CreateIndex
CREATE INDEX "staff_daily_performance_staffName_date_idx" ON "staff_daily_performance"("staffName", "date");

-- CreateIndex
CREATE INDEX "staff_daily_performance_date_idx" ON "staff_daily_performance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_daily_performance_date_airline_staffName_key" ON "staff_daily_performance"("date", "airline", "staffName");

-- CreateIndex
CREATE INDEX "airline_daily_metrics_airline_date_idx" ON "airline_daily_metrics"("airline", "date");

-- CreateIndex
CREATE INDEX "airline_daily_metrics_date_idx" ON "airline_daily_metrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "airline_daily_metrics_date_airline_key" ON "airline_daily_metrics"("date", "airline");

-- CreateIndex
CREATE INDEX "booking_jobs_sessionKey_createdAt_idx" ON "booking_jobs"("sessionKey", "createdAt");

-- CreateIndex
CREATE INDEX "booking_jobs_status_idx" ON "booking_jobs"("status");

-- CreateIndex
CREATE INDEX "booking_jobs_userId_idx" ON "booking_jobs"("userId");

-- CreateIndex
CREATE INDEX "booking_jobs_pnr_idx" ON "booking_jobs"("pnr");

-- CreateIndex
CREATE INDEX "user_airline_credentials_userId_airline_idx" ON "user_airline_credentials"("userId", "airline");

-- CreateIndex
CREATE UNIQUE INDEX "user_airline_credentials_userId_airline_key" ON "user_airline_credentials"("userId", "airline");

-- CreateIndex
CREATE UNIQUE INDEX "user_bookings_jobId_key" ON "user_bookings"("jobId");

-- CreateIndex
CREATE INDEX "user_bookings_userId_bookedAt_idx" ON "user_bookings"("userId", "bookedAt");

-- CreateIndex
CREATE INDEX "user_bookings_userId_pnr_idx" ON "user_bookings"("userId", "pnr");

-- CreateIndex
CREATE INDEX "user_bookings_airline_idx" ON "user_bookings"("airline");

-- CreateIndex
CREATE INDEX "user_bookings_status_idx" ON "user_bookings"("status");

-- CreateIndex
CREATE INDEX "pnr_verifications_pnr_airline_idx" ON "pnr_verifications"("pnr", "airline");

-- CreateIndex
CREATE INDEX "pnr_verifications_verifiedAt_idx" ON "pnr_verifications"("verifiedAt");

-- AddForeignKey
ALTER TABLE "airline_balance_history" ADD CONSTRAINT "airline_balance_history_airline_fkey" FOREIGN KEY ("airline") REFERENCES "airline_wallets"("airline") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airline_connector_settings" ADD CONSTRAINT "airline_connector_settings_airline_fkey" FOREIGN KEY ("airline") REFERENCES "airline_wallets"("airline") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airline_sync_logs" ADD CONSTRAINT "airline_sync_logs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "airline_sync_runs"("runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_search_records" ADD CONSTRAINT "flight_search_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sales" ADD CONSTRAINT "staff_sales_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "sales_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "sales_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_tickets" ADD CONSTRAINT "sales_tickets_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "sales_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_report_analytics" ADD CONSTRAINT "sales_report_analytics_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "sales_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bookings" ADD CONSTRAINT "user_bookings_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "booking_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bookings" ADD CONSTRAINT "user_bookings_userId_airline_fkey" FOREIGN KEY ("userId", "airline") REFERENCES "user_airline_credentials"("userId", "airline") ON DELETE RESTRICT ON UPDATE CASCADE;

