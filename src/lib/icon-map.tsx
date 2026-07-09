import {
  LayoutDashboard,
  Target,
  Building2,
  Wallet,
  Ticket,
  Users,
  BookOpen,
  LineChart,
  Settings,
  FileBarChart,
  Sparkles,
  RefreshCw,
  TrendingUp,
  CalendarDays,
  CalendarRange,
  Clock,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  Search,
  type LucideIcon,
} from "lucide-react";

// Central icon registry — one place to keep sidebar / dashboard / section
// icons visually consistent (same stroke width, same family) instead of the
// original app's mixed emoji set.
export const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  target: Target,
  "building-2": Building2,
  wallet: Wallet,
  ticket: Ticket,
  users: Users,
  "book-open": BookOpen,
  "line-chart": LineChart,
  settings: Settings,
  "file-bar-chart": FileBarChart,
  sparkles: Sparkles,
  "refresh-cw": RefreshCw,
  "trending-up": TrendingUp,
  "calendar-days": CalendarDays,
  "calendar-range": CalendarRange,
  clock: Clock,
  inbox: Inbox,
  "alert-triangle": AlertTriangle,
  "check-circle": CheckCircle2,
  search: Search,
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICONS[name] || Inbox;
  return <Cmp size={size} className={className} strokeWidth={2} aria-hidden />;
}
