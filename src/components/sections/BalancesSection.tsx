"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { AIRLINE_LOGO_MAP, AIRLINES } from "@/lib/constants";
import { formatNaira, todayISO, nowTime } from "@/lib/utils";
import Modal from "@/components/ui/Modal";

export default function BalancesSection() {
  const { balances, settings, updateBalance, addDeposit } = useApp();
  const [updateModal, setUpdateModal] = useState<string | null>(null);
  const [fundModal, setFundModal] = useState<string | null>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [fundDate, setFundDate] = useState(todayISO());
  const [fundTime, setFundTime] = useState(nowTime());

  const total = useMemo(() => balances.reduce((s, b) => s + b.balance, 0), [balances]);

  function openUpdate(airline: string) {
    const bal = balances.find((b) => b.airline === airline);
    setBalanceInput(bal ? String(bal.balance) : "0");
    setUpdateModal(airline);
  }
  function openFund(airline: string) {
    setFundAmount("");
    setFundDate(todayISO());
    setFundTime(nowTime());
    setFundModal(airline);
  }
  function saveUpdate() {
    if (!updateModal) return;
    const val = parseFloat(balanceInput);
    if (isNaN(val) || val < 0) return;
    updateBalance(updateModal, val);
    setUpdateModal(null);
  }
  function saveFund() {
    if (!fundModal) return;
    const val = parseFloat(fundAmount);
    if (isNaN(val) || val <= 0) return;
    addDeposit(fundModal, val, fundDate, fundTime);
    setFundModal(null);
  }

  function tierClass(bal: number): "" | "low-balance" | "critical" {
    if (bal < settings.thresholdCritical) return "critical";
    if (bal < settings.thresholdLow) return "low-balance";
    return "";
  }
  function amountClass(bal: number): "" | "low" | "critical" {
    if (bal < settings.thresholdCritical) return "critical";
    if (bal < settings.thresholdLow) return "low";
    return "";
  }
  function barClass(bal: number): "" | "low" | "critical" {
    if (bal < settings.thresholdCritical) return "critical";
    if (bal < settings.thresholdLow) return "low";
    return "";
  }

  const maxBalance = Math.max(1, ...balances.map((b) => b.balance));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Airline Deposits</div>

      <div className="total-balance-card">
        <div>
          <div className="total-label">Total Balance Across All Airlines</div>
          <div className="total-amount">{formatNaira(total)}</div>
          <div className="total-sub">{balances.length} airline accounts tracked</div>
        </div>
      </div>

      <div className="balances-grid">
        {AIRLINES.map((a) => {
          const b = balances.find((x) => x.airline === a.name);
          const bal = b?.balance ?? 0;
          const pct = Math.max(4, Math.round((bal / maxBalance) * 100));
          const logo = AIRLINE_LOGO_MAP[a.code];
          return (
            <div className={`balance-card ${tierClass(bal)}`} key={a.code}>
              <div className="balance-top">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={a.name} className="balance-airline-logo" />
                ) : (
                  <div className="balance-airline-fallback" style={{ background: a.color }}>
                    {a.abbr}
                  </div>
                )}
                <div>
                  <div className="balance-airline-name">{a.name}</div>
                  <div className="balance-updated">{b?.updated || "Not yet updated"}</div>
                </div>
              </div>
              <div className={`balance-amount ${amountClass(bal)}`}>{formatNaira(bal)}</div>
              <div className="balance-bar-bg">
                <div className={`balance-bar ${barClass(bal)}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="balance-actions">
                <button className="update-btn" onClick={() => openUpdate(a.name)}>
                  Set Balance
                </button>
                <button className="fund-btn" onClick={() => openFund(a.name)}>
                  + Fund
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!updateModal}
        onClose={() => setUpdateModal(null)}
        title={`Update Balance — ${updateModal ?? ""}`}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setUpdateModal(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveUpdate}>
              Save Balance
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>New Balance (₦)</label>
          <input
            type="number"
            className="balance-input-big"
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
            min={0}
            autoFocus
          />
        </div>
      </Modal>

      <Modal
        open={!!fundModal}
        onClose={() => setFundModal(null)}
        title={`Fund Account — ${fundModal ?? ""}`}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setFundModal(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveFund}>
              Confirm Deposit
            </button>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Deposit Amount (₦)</label>
          <input
            type="number"
            className="balance-input-big"
            value={fundAmount}
            onChange={(e) => setFundAmount(e.target.value)}
            min={0}
            autoFocus
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={fundDate} onChange={(e) => setFundDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Time</label>
            <input type="time" value={fundTime} onChange={(e) => setFundTime(e.target.value)} />
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
