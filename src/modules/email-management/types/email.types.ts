/**
 * Email Management System - Type Definitions
 * All TypeScript interfaces for request/response payloads and API contracts
 */

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface UploadTicketRequest {
  imageData: string; // base64 encoded image
  command: string; // e.g., "Refund", "Void", "Reschedule to 31/08/2026 LOS-ABV at 7:30 AM"
  chatId: string; // WhatsApp chat ID
  messageId?: string; // Optional WhatsApp message ID for reference
}

export interface UploadTicketResponse {
  success: boolean;
  caseId?: string;
  draft?: EmailDraftPreview;
  error?: string;
}

export interface SendEmailRequest {
  caseId: string;
  approvedByUser?: string;
}

export interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  sentAt?: string;
  error?: string;
}

export interface EditDraftRequest {
  caseId: string;
  subject?: string;
  emailBody?: string;
  editedByUser?: string;
}

export interface EditDraftResponse {
  success: boolean;
  updatedDraft?: EmailDraftPreview;
  error?: string;
}

export interface CancelCaseRequest {
  caseId: string;
  reason?: string;
  cancelledByUser?: string;
}

export interface CancelCaseResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface GetCaseStatusRequest {
  caseId: string;
}

export interface GetCaseStatusResponse {
  success: boolean;
  case?: EmailCaseDetail;
  error?: string;
}

export interface ManualStatusUpdateResponse {
  success: boolean;
  report?: DailyReportSummary;
  error?: string;
}

// ============================================================================
// Email Case & Draft Types
// ============================================================================

export interface EmailDraftPreview {
  caseId: string;
  caseNumber: string;
  airline: {
    code: string;
    name: string;
  };
  pnr: string;
  passengerNames: string[];
  requestType: string;
  route?: string;
  newTravelDate?: string;
  departureTime?: string;
  toRecipient: string;
  ccRecipients: string[];
  subject: string;
  emailBody: string;
  status: string;
  createdAt: string;
}

export interface EmailCaseDetail {
  id: string;
  caseNumber: string;
  airline: {
    code: string;
    name: string;
  };
  pnr: string;
  passengerNames: string[];
  requestType: string;
  route?: string;
  newTravelDate?: string;
  departureTime?: string;
  subject: string;
  emailBody: string;
  toRecipient: string;
  ccRecipients: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  dateApproved?: string;
  dateSent?: string;
  dateLastResponse?: string;
  whatsappChatId?: string;
  whatsappMessageId?: string;
  createdByUser?: string;
  approvedByUser?: string;
  replies?: EmailReplyDetail[];
  auditTrail?: AuditLogDetail[];
}

export interface EmailReplyDetail {
  id: string;
  fromEmail: string;
  subject: string;
  body: string;
  replyDate: string;
  statusUpdate?: string;
}

export interface AuditLogDetail {
  id: string;
  action: string;
  userId?: string;
  timestamp: string;
  details?: Record<string, any>;
}

// ============================================================================
// Ticket Extraction Types
// ============================================================================

export interface TicketExtractionData {
  airline?: string;
  airlineCode?: string;
  pnr?: string;
  passengerNames?: string[];
  route?: string;
  travelDate?: string;
  departureTime?: string;
  rawText?: string;
  confidence: number;
  errors?: string[];
}

// ============================================================================
// Report Types
// ============================================================================

export interface DailyReportSummary {
  reportDate: string;
  reportType: "SUMMARY" | "EOD";
  metrics: ReportMetrics;
  cases?: CaseSummaryForReport[];
  whatsappText?: string;
}

export interface ReportMetrics {
  emailsSent: number;
  repliesReceived: number;
  pendingCases: number;
  approvedRefunds: number;
  completedVoids: number;
  completedReschedules: number;
  additionalInfoNeeded: number;
  rejectedCases: number;
}

export interface CaseSummaryForReport {
  caseNumber: string;
  pnr: string;
  airline: string;
  passengerName: string;
  requestType: string;
  status: string;
  daysWaiting?: number;
}

// ============================================================================
// Error Response Type
// ============================================================================

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, any>;
}

// ============================================================================
// Pagination Types (for future use)
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
