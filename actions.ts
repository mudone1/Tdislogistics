"use server";

import { verifyStaffSession } from "@/lib/staffAuth";
import { getDownline, getStatsForStaffIds, getApplicantSummariesForStaffIds, type StaffStats, type ApplicantSummary } from "@/lib/downline";
import { areReferralLinksHidden } from "@/lib/referral";
import { PHASE2_STATUS_INFO } from "@/lib/phase2Status";
import type { StaffRecord } from "@/lib/types";

const LINKS_HIDDEN_MESSAGE = "Referral links are temporarily paused while we complete bank verification training — check back soon.";

export interface DashboardMember {
  staffId: string;
  fullName: string;
  tier: string;
  link: string;
  submissions: number;
  completed: number;
  conversionRate: number;
}

export interface DashboardStaffDetail {
  staffId: string;
  fullName: string;
  tier: string;
  state: string;
  phone: string;
  address: string;
}

export interface DashboardApplicant {
  applicationId: string;
  applicantName: string;
  businessName: string;
  grantCategoryName: string;
  statusLabel: string;
}

export interface DashboardTeamStats {
  totalSubmissions: number;
  totalCompleted: number;
  conversionRate: number;
}

export interface DashboardData {
  ok: true;
  self: DashboardMember;
  downline: DashboardMember[];
  staffDetails: DashboardStaffDetail[];
  applicants: DashboardApplicant[];
  teamStats: DashboardTeamStats;
  timeSeries: { date: string; count: number }[];
  categoryBreakdown: { name: string; count: number }[];
}

export interface DashboardError {
  ok: false;
  error: string;
}

function toMember(staff: StaffRecord, stats: StaffStats | undefined, linksHidden: boolean): DashboardMember {
  return {
    staffId: staff.staffId,
    fullName: staff.fullName,
    tier: staff.tier,
    link: linksHidden ? LINKS_HIDDEN_MESSAGE : stats?.link || "(link not generated yet)",
    submissions: stats?.submissions ?? 0,
    completed: stats?.completed ?? 0,
    conversionRate: stats?.conversionRate ?? 0,
  };
}

// Role-scoped staff directory info for a Regional/State Coordinator's
// downline — Staff ID, state, phone number, and home address. Never
// includes anything beyond what the requesting staff member's own
// downline (per getDownline) already covers, so a State Coordinator only
// ever sees their Marketing Officers and a Regional Coordinator sees their
// State Coordinators plus, transitively, those coordinators' Marketing
// Officers. Marketing Officers have no downline, so this is always empty
// for them — they only ever see their own Staff ID (in `self`).
function toStaffDetail(staff: StaffRecord): DashboardStaffDetail {
  return {
    staffId: staff.staffId,
    fullName: staff.fullName,
    tier: staff.tier,
    state: staff.state || "—",
    phone: staff.phone || "—",
    address: staff.homeAddress || "—",
  };
}

function buildTeamStats(applicantSummaries: ApplicantSummary[]): DashboardTeamStats {
  const totalSubmissions = applicantSummaries.length;
  const totalCompleted = applicantSummaries.filter((a) => a.status === "phase2_marked_complete").length;
  return {
    totalSubmissions,
    totalCompleted,
    conversionRate: totalSubmissions ? Math.round((totalCompleted / totalSubmissions) * 100) : 0,
  };
}

function buildTimeSeries(applicantSummaries: ApplicantSummary[]): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of applicantSummaries) {
    if (!a.createdAt) continue;
    const day = a.createdAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([date, count]) => ({ date: date.slice(5), count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildCategoryBreakdown(applicantSummaries: ApplicantSummary[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of applicantSummaries) {
    if (!a.grantCategoryName) continue;
    counts.set(a.grantCategoryName, (counts.get(a.grantCategoryName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function statusLabelFor(a: ApplicantSummary): string {
  if (a.status === "phase2_marked_complete") return "Completed";
  if (a.phase2VerificationStatus) return PHASE2_STATUS_INFO[a.phase2VerificationStatus as keyof typeof PHASE2_STATUS_INFO].label;
  if (!a.phase2Unlocked) return "Phase 2 · Pending (Available in 48 Hours)";
  return "Phase 2 · Awaiting account details";
}

export async function getMyDashboardData(idToken: string): Promise<DashboardData | DashboardError> {
  const verified = await verifyStaffSession(idToken);
  if (!verified.ok) return { ok: false, error: verified.error };

  const { session } = verified;
  const downlineStaff = await getDownline(session.staffId);
  const allIds = [session.staffId, ...downlineStaff.map((s) => s.staffId)];
  const [stats, applicantSummaries, linksHidden] = await Promise.all([
    getStatsForStaffIds(allIds),
    getApplicantSummariesForStaffIds(allIds),
    areReferralLinksHidden(),
  ]);

  return {
    ok: true,
    self: toMember(session.staff, stats.get(session.staffId), linksHidden),
    downline: downlineStaff
      .map((s) => toMember(s, stats.get(s.staffId), linksHidden))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    staffDetails: downlineStaff
      .map(toStaffDetail)
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    applicants: applicantSummaries
      .map((a) => ({
        applicationId: a.applicationId,
        applicantName: a.applicantName,
        businessName: a.businessName,
        grantCategoryName: a.grantCategoryName,
        statusLabel: statusLabelFor(a),
      }))
      .sort((a, b) => a.applicantName.localeCompare(b.applicantName)),
    teamStats: buildTeamStats(applicantSummaries),
    timeSeries: buildTimeSeries(applicantSummaries),
    categoryBreakdown: buildCategoryBreakdown(applicantSummaries),
  };
}
