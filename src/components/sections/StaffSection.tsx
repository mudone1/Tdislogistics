"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { getRoleLabel } from "@/lib/constants";
import { formatNaira, initials } from "@/lib/utils";
import Modal from "@/components/ui/Modal";

export default function StaffSection() {
  const { allUsers, bookingUpdates, currentUser, updateStaffContact, addStaffMember, hasPermission } = useApp();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("agent");

  const canManage = hasPermission("manage_users") || (currentUser && ["admin", "manager", "superadmin"].includes(currentUser.role));

  const kpisByStaff = useMemo(() => {
    const map: Record<string, { bookings: number; revenue: number; clients: Set<string>; unpaid: number }> = {};
    allUsers.forEach((u) => {
      map[u.name] = { bookings: 0, revenue: 0, clients: new Set(), unpaid: 0 };
    });
    bookingUpdates.forEach((b) => {
      const key = b.initiatedBy;
      if (!map[key]) map[key] = { bookings: 0, revenue: 0, clients: new Set(), unpaid: 0 };
      if (b.status !== "Cancelled") {
        map[key].bookings += 1;
        map[key].revenue += b.amount;
        map[key].clients.add(b.client);
        map[key].unpaid += Math.max(0, b.amount - (b.amountPaid || 0));
      }
    });
    return map;
  }, [allUsers, bookingUpdates]);

  function startEdit(userId: number, phone?: string, email?: string) {
    setEditingId(userId);
    setEditPhone(phone || "");
    setEditEmail(email || "");
  }
  function saveEdit(userId: number) {
    updateStaffContact(userId, editPhone, editEmail);
    setEditingId(null);
  }

  function saveNewStaff() {
    const ok = addStaffMember({ name: newName, username: newUsername, password: newPassword, role: newRole });
    if (ok) {
      setNewName("");
      setNewUsername("");
      setNewPassword("");
      setNewRole("agent");
      setAddOpen(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Staff Directory</div>

      {canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button className="add-staff-btn" onClick={() => setAddOpen(true)}>
            ➕ Add Staff Member
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {allUsers
          .filter((u) => u.status === "active")
          .map((u) => {
            const kpi = kpisByStaff[u.name] || { bookings: 0, revenue: 0, clients: new Set(), unpaid: 0 };
            const isEditing = editingId === u.id;
            return (
              <div className="staff-card" key={u.id}>
                <div className="staff-card-header">
                  <div className="staff-avatar-lg">{initials(u.name)}</div>
                  <div className="staff-info">
                    <div className="staff-name">{u.name}</div>
                    <span className={`staff-role-badge ${u.role}`}>{getRoleLabel(u.role)}</span>
                  </div>
                </div>

                <div className="staff-contact">
                  <div className="staff-contact-row">
                    <span>📞</span> {u.phone || "Not set"}
                    {canManage && (
                      <button className="staff-contact-edit" onClick={() => startEdit(u.id, u.phone, u.email)}>
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="staff-contact-row">
                    <span>✉️</span> {u.email || "Not set"}
                  </div>
                </div>

                {isEditing && (
                  <div className="staff-edit-row open">
                    <input type="text" placeholder="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                    <input type="email" placeholder="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                    <div className="staff-edit-actions">
                      <button className="staff-cancel-btn" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button className="staff-save-btn" onClick={() => saveEdit(u.id)}>
                        Save
                      </button>
                    </div>
                  </div>
                )}

                <div className="staff-kpis">
                  <div className="staff-kpi-item">
                    <div className="staff-kpi-value blue">{kpi.bookings}</div>
                    <div className="staff-kpi-label">Bookings</div>
                  </div>
                  <div className="staff-kpi-item">
                    <div className="staff-kpi-value green">{kpi.clients.size}</div>
                    <div className="staff-kpi-label">Clients</div>
                  </div>
                  <div className="staff-kpi-item">
                    <div className={`staff-kpi-value ${kpi.unpaid > 0 ? "amber" : ""}`}>{formatNaira(kpi.unpaid, false)}</div>
                    <div className="staff-kpi-label">Unpaid</div>
                  </div>
                </div>

                <div className="staff-revenue-bar">
                  <div className="staff-revenue-label">
                    <span>Revenue Generated</span>
                  </div>
                  <div className="staff-revenue-amount">{formatNaira(kpi.revenue)}</div>
                </div>
              </div>
            );
          })}
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="➕ Add Staff Member"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveNewStaff}>
              Save
            </button>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Full Name</label>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Username</label>
            <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Role</label>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="agent">Staff Agent</option>
            <option value="manager">Operational Manager</option>
            <option value="independent">TDIS Independent Agent</option>
            <option value="frontdesk">Front Desk Staff</option>
          </select>
        </div>
      </Modal>
    </motion.div>
  );
}
