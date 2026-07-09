"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/store";
import { isAdminRole } from "@/lib/constants";
import type { SectionId } from "@/lib/types";
import LoginScreen from "@/components/layout/LoginScreen";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import ToastArea from "@/components/layout/ToastArea";
import DashboardSection from "@/components/sections/DashboardSection";
import GoalsSection from "@/components/sections/GoalsSection";
import AirlinesSection from "@/components/sections/AirlinesSection";
import BalancesSection from "@/components/sections/BalancesSection";
import UpdateBookingsSection from "@/components/sections/UpdateBookingsSection";
import ClientsSection from "@/components/sections/ClientsSection";
import StaffSection from "@/components/sections/StaffSection";
import AdminSection from "@/components/sections/admin/AdminSection";
import ClientDebtSection from "@/components/sections/ClientDebtSection";
import DebtDashboardSection from "@/components/sections/DebtDashboardSection";

export default function Home() {
  const { currentUser, authReady, hasPermission } = useApp();
  const [active, setActive] = useState<SectionId>("dashboard");

  if (!authReady) {
    return <div style={{ minHeight: "100vh" }} />;
  }

  if (!currentUser) {
    return (
      <>
        <LoginScreen />
        <ToastArea />
      </>
    );
  }

  const isAdmin = isAdminRole(currentUser.role);

  function renderSection(id: SectionId) {
    switch (id) {
      case "dashboard":
        return <DashboardSection />;
      case "goals":
        return <GoalsSection />;
      case "airlines":
        return <AirlinesSection />;
      case "balances":
        return <BalancesSection />;
      case "updateBookings":
        return hasPermission("update_bookings") ? <UpdateBookingsSection /> : <NoAccess />;
      case "clients":
        return hasPermission("view_clients") ? <ClientsSection /> : <NoAccess />;
      case "staff":
        return <StaffSection />;
      case "clientDebt":
        return <ClientDebtSection />;
      case "debtDashboard":
        return <DebtDashboardSection />;
      case "admin":
        return isAdmin ? <AdminSection /> : <NoAccess />;
      default:
        return <DashboardSection />;
    }
  }

  return (
    <>
      <Header />
      <div className="app-body">
        <Sidebar active={active} onSelect={setActive} />
        <div className="main">
          <AnimatePresence mode="wait">
            <div key={active} className="section active">
              {renderSection(active)}
            </div>
          </AnimatePresence>
        </div>
      </div>
      <ToastArea />
    </>
  );
}

function NoAccess() {
  return (
    <div className="empty-state">
      <div className="empty-icon">🔒</div>
      <div className="empty-title">Restricted Access</div>
      <div className="empty-sub">You don&apos;t have permission to view this section.</div>
    </div>
  );
}
