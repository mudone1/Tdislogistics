"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AIRLINES,
  DEFAULT_SETTINGS,
  DEFAULT_USERS,
  LOCAL_CREDENTIALS,
  STAFF_PERMISSIONS,
  isAdminRole,
} from "./constants";
import { authHelper, fsListen, fsLoad, fsSave } from "./firebase";
import type {
  AppUser,
  Balance,
  BookingUpdate,
  Client,
  CurrentUser,
  DebtGroup,
  Deposit,
  SalesGoals,
  SystemLog,
  SystemSettings,
} from "./types";
import { formatDateTime, todayISO, nowTime, uid } from "./utils";

// ─── local storage helpers ───
function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled */
  }
}

function ensureAllAirlines(bal: Balance[]): Balance[] {
  const out = [...bal];
  AIRLINES.forEach((a) => {
    if (!out.find((b) => b.airline === a.name)) {
      out.push({ airline: a.name, balance: 0, updated: "Not yet updated" });
    }
  });
  return out;
}

export interface Toast {
  id: number;
  message: string;
  type: "success" | "warn";
}

interface AppState {
  // auth
  currentUser: CurrentUser | null;
  authReady: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (name: string, email: string, password: string, role: string) => Promise<boolean>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;

  // data
  balances: Balance[];
  clients: Client[];
  bookingUpdates: BookingUpdate[];
  deposits: Deposit[];
  allUsers: AppUser[];
  systemLogs: SystemLog[];
  salesGoals: SalesGoals;
  debtGroups: DebtGroup[];
  settings: SystemSettings;

  // actions
  updateBalance: (airline: string, newBalance: number) => void;
  addDeposit: (airline: string, amount: number, date: string, time: string) => void;
  addClient: (client: Omit<Client, "id" | "createdAt">) => Client;
  saveBookingUpdate: (b: Omit<BookingUpdate, "updated" | "createdAt">) => boolean;
  updateClientPayment: (bookingIndex: number, amount: number) => void;
  deleteBookingUpdate: (index: number) => void;
  setGoal: (period: keyof SalesGoals, value: number) => void;
  addStaffMember: (input: {
    name: string;
    username: string;
    password: string;
    role: string;
    phone?: string;
    email?: string;
  }) => boolean;
  updateStaffContact: (userId: number, phone: string, email: string) => void;
  toggleUserStatus: (userId: number) => void;
  deleteUser: (userId: number) => void;
  updateUserPermission: (userId: number, permission: string, checked: boolean) => void;
  createNewUser: (input: { username: string; password: string; name: string; role: string }) => boolean;
  addDebtGroup: (name: string, initialBill: number) => boolean;
  addDebtTransaction: (
    groupId: string,
    desc: string,
    amount: number,
    type: "charge" | "payment",
    status: "pending" | "paid"
  ) => void;
  markDebtTxPaid: (groupId: string, txId: string) => void;
  deleteDebtTx: (groupId: string, txId: string) => void;
  deleteDebtGroup: (groupId: string) => void;
  updateSettings: (patch: Partial<SystemSettings>) => void;
  runBulkAction: (action: string) => void;
  resetData: (type: "bookings" | "clients" | "balances" | "logs") => void;
  logActivity: (action: string, details: string) => void;

  // toasts
  toasts: Toast[];
  showToast: (message: string, type?: "success" | "warn") => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [balances, setBalances] = useState<Balance[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [bookingUpdates, setBookingUpdates] = useState<BookingUpdate[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>(DEFAULT_USERS);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [salesGoals, setSalesGoals] = useState<SalesGoals>({});
  const [debtGroups, setDebtGroups] = useState<DebtGroup[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);

  const showToast = useCallback((message: string, type: "success" | "warn" = "success") => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const logActivity = useCallback(
    (action: string, details: string) => {
      setSystemLogs((prev) => {
        const next = [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            user: currentUser ? currentUser.name : "System",
            action,
            details,
          },
        ];
        writeLS("tdis_systemLogs", next);
        return next;
      });
    },
    [currentUser]
  );

  // ─── bootstrap: local data first (fast paint), then Firestore, then live listeners ───
  useEffect(() => {
    setBalances(ensureAllAirlines(readLS("tdis_balances", [])));
    setClients(readLS("tdis_clients", []));
    setBookingUpdates(readLS("tdis_bookingUpdates", []));
    setDeposits(readLS("tdis_deposits", []));
    setAllUsers(readLS("tdis_users", DEFAULT_USERS));
    setSystemLogs(readLS("tdis_systemLogs", []));
    setSalesGoals(readLS("tdis_goals", {}));
    setDebtGroups(readLS("tdis_debtGroups", []));
    setSettings(readLS("tdis_settings", DEFAULT_SETTINGS));

    const savedSession = readLS<CurrentUser | null>("tdis_currentUser_session", null);
    if (savedSession) setCurrentUser(savedSession);
    setAuthReady(true);

    (async () => {
      const [fsBalances, fsClients, fsBookings, fsDebtGroups, fsUsers] = await Promise.all([
        fsLoad<Balance[]>("balances", "tdis_balances", []),
        fsLoad<Client[]>("clients", "tdis_clients", []),
        fsLoad<BookingUpdate[]>("bookingUpdates", "tdis_bookingUpdates", []),
        fsLoad<DebtGroup[]>("debtGroups", "tdis_debtGroups", []),
        fsLoad<AppUser[]>("users", "tdis_users", DEFAULT_USERS),
      ]);
      setBalances(ensureAllAirlines(fsBalances));
      setClients(fsClients);
      setBookingUpdates(
        fsBookings.map((b) => ({ ...b, amountPaid: b.amountPaid != null ? b.amountPaid : b.status === "Paid" ? b.amount : 0 }))
      );
      setDebtGroups(fsDebtGroups);
      if (fsUsers.length) setAllUsers(fsUsers);
    })();

    const unsubs = [
      fsListen<Balance[]>("balances", (data) => {
        const next = ensureAllAirlines(data);
        setBalances(next);
        writeLS("tdis_balances", next);
      }),
      fsListen<Client[]>("clients", (data) => {
        setClients(data);
        writeLS("tdis_clients", data);
      }),
      fsListen<BookingUpdate[]>("bookingUpdates", (data) => {
        const next = data.map((b) => ({
          ...b,
          amountPaid: b.amountPaid != null ? b.amountPaid : b.status === "Paid" ? b.amount : 0,
        }));
        setBookingUpdates(next);
        writeLS("tdis_bookingUpdates", next);
      }),
      fsListen<DebtGroup[]>("debtGroups", (data) => {
        setDebtGroups(data);
        writeLS("tdis_debtGroups", data);
      }),
      fsListen<AppUser[]>("users", (data) => {
        setAllUsers(data);
        writeLS("tdis_users", data);
      }),
    ];

    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── clock-independent persistence helpers ───
  const persistBalances = useCallback((next: Balance[]) => {
    setBalances(next);
    writeLS("tdis_balances", next);
    fsSave("balances", next);
  }, []);
  const persistClients = useCallback((next: Client[]) => {
    setClients(next);
    writeLS("tdis_clients", next);
    fsSave("clients", next);
  }, []);
  const persistBookings = useCallback((next: BookingUpdate[]) => {
    setBookingUpdates(next);
    writeLS("tdis_bookingUpdates", next);
    fsSave("bookingUpdates", next);
  }, []);
  const persistUsers = useCallback((next: AppUser[]) => {
    setAllUsers(next);
    writeLS("tdis_users", next);
    fsSave("users", next);
  }, []);
  const persistDebtGroups = useCallback((next: DebtGroup[]) => {
    setDebtGroups(next);
    writeLS("tdis_debtGroups", next);
    fsSave("debtGroups", next);
  }, []);
  const persistDeposits = useCallback((next: Deposit[]) => {
    setDeposits(next);
    writeLS("tdis_deposits", next);
  }, []);
  const persistGoals = useCallback((next: SalesGoals) => {
    setSalesGoals(next);
    writeLS("tdis_goals", next);
  }, []);
  const persistSettings = useCallback((next: SystemSettings) => {
    setSettings(next);
    writeLS("tdis_settings", next);
  }, []);

  // ─── AUTH ───
  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      const pwd = password.trim();
      const savedLocalUsers = readLS<
        { email: string; password: string; name: string; role: string; permissions: string[] }[]
      >("tdis_localUsers", []);
      const localUser = [...LOCAL_CREDENTIALS, ...savedLocalUsers].find(
        (u) => u.email === normalizedEmail && u.password === pwd
      );
      if (localUser) {
        const user: CurrentUser = {
          uid: normalizedEmail,
          email: localUser.email,
          name: localUser.name,
          role: localUser.role as CurrentUser["role"],
          permissions: localUser.permissions,
        };
        setCurrentUser(user);
        writeLS("tdis_currentUser_session", user);
        showToast(`✓ Welcome, ${user.name}!`, "success");
        return true;
      }
      try {
        await authHelper.signIn(normalizedEmail, pwd);
        return true;
      } catch {
        logActivity("FAILED_LOGIN", `Failed login attempt with username: ${normalizedEmail}`);
        return false;
      }
    },
    [showToast, logActivity]
  );

  const signup = useCallback(
    async (name: string, email: string, password: string, role: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      const savedUsers = readLS<
        { email: string; password: string; name: string; role: string; permissions: string[]; status: string; createdAt: string }[]
      >("tdis_localUsers", []);
      const allLocal = [...LOCAL_CREDENTIALS, ...savedUsers];
      if (allLocal.find((u) => u.email === normalizedEmail)) return false;

      const permissions = isAdminRole(role)
        ? ["view_all", "manage_users", "manage_balances", "view_analytics", "edit_clients", "delete_bookings", "view_balances", "update_bookings", "manage_clients", "view_clients"]
        : STAFF_PERMISSIONS;

      const newLocalUser = {
        email: normalizedEmail,
        password: password.trim(),
        name,
        role,
        permissions,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      savedUsers.push(newLocalUser);
      writeLS("tdis_localUsers", savedUsers);

      const newStaffEntry: AppUser = {
        id: Date.now(),
        username: normalizedEmail,
        password: password.trim(),
        name,
        role: role as AppUser["role"],
        permissions,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      persistUsers([...allUsers, newStaffEntry]);

      const user: CurrentUser = {
        uid: normalizedEmail,
        email: normalizedEmail,
        name,
        role: role as CurrentUser["role"],
        permissions,
      };
      setCurrentUser(user);
      writeLS("tdis_currentUser_session", user);
      showToast(`✓ Account created! Welcome, ${name}!`, "success");
      return true;
    },
    [allUsers, persistUsers, showToast]
  );

  const logout = useCallback(() => {
    if (currentUser) logActivity("LOGOUT", `${currentUser.name} logged out`);
    setCurrentUser(null);
    if (typeof window !== "undefined") localStorage.removeItem("tdis_currentUser_session");
    authHelper.signOut().catch(() => {});
    showToast("✓ Logged out successfully", "success");
  }, [currentUser, logActivity, showToast]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!currentUser) return false;
      if (isAdminRole(currentUser.role)) return true;
      return currentUser.permissions?.includes(permission) ?? false;
    },
    [currentUser]
  );

  // ─── BALANCES / DEPOSITS ───
  const updateBalance = useCallback(
    (airline: string, newBalance: number) => {
      const next = balances.map((b) =>
        b.airline === airline ? { ...b, balance: newBalance, updated: formatDateTime() } : b
      );
      persistBalances(next);
      logActivity("UPDATE_BALANCE", `Set ${airline} balance to ₦${newBalance.toLocaleString("en-NG")}`);
      showToast(`✓ ${airline} balance updated`, "success");
    },
    [balances, persistBalances, logActivity, showToast]
  );

  const addDeposit = useCallback(
    (airline: string, amount: number, date: string, time: string) => {
      const newDeposit: Deposit = { id: Date.now(), airline, amount, date, time, loggedAt: new Date().toISOString() };
      persistDeposits([...deposits, newDeposit]);
      const current = balances.find((b) => b.airline === airline)?.balance ?? 0;
      const next = balances.map((b) =>
        b.airline === airline ? { ...b, balance: current + amount, updated: formatDateTime() } : b
      );
      persistBalances(next);
      logActivity("FUND_ACCOUNT", `Deposited ₦${amount.toLocaleString("en-NG")} into ${airline}`);
      showToast(`✓ ₦${amount.toLocaleString("en-NG")} deposited to ${airline}`, "success");
    },
    [deposits, balances, persistDeposits, persistBalances, logActivity, showToast]
  );

  // ─── CLIENTS ───
  const addClient = useCallback(
    (client: Omit<Client, "id" | "createdAt">) => {
      const newClient: Client = { ...client, id: Date.now(), createdAt: new Date().toISOString() };
      persistClients([...clients, newClient]);
      logActivity("ADD_CLIENT", `Added new client: ${newClient.name}`);
      showToast(`✓ Client added: ${newClient.name}`, "success");
      return newClient;
    },
    [clients, persistClients, logActivity, showToast]
  );

  // ─── BOOKINGS ───
  const saveBookingUpdate = useCallback(
    (b: Omit<BookingUpdate, "updated" | "createdAt">) => {
      if (!hasPermission("update_bookings")) {
        showToast("You do not have permission to update bookings", "warn");
        return false;
      }
      const entry: BookingUpdate = { ...b, updated: formatDateTime(), createdAt: new Date().toISOString() };
      persistBookings([...bookingUpdates, entry]);
      logActivity("BOOKING_UPDATE", `Recorded ${entry.bookingType} booking for ${entry.client} (${entry.airline})`);
      showToast(`✓ Booking saved for ${entry.client}`, "success");
      return true;
    },
    [bookingUpdates, hasPermission, persistBookings, logActivity, showToast]
  );

  const updateClientPayment = useCallback(
    (bookingIndex: number, amount: number) => {
      const next = [...bookingUpdates];
      const booking = next[bookingIndex];
      if (!booking) return;
      const prevPaid = booking.amountPaid || 0;
      const totalPaid = prevPaid + amount;
      if (totalPaid >= booking.amount) {
        booking.amountPaid = booking.amount;
        booking.status = "Paid";
      } else {
        booking.amountPaid = totalPaid;
        booking.status = "Partial";
      }
      booking.updated = formatDateTime();
      persistBookings(next);
      logActivity("PAYMENT_UPDATE", `Recorded ₦${amount.toLocaleString("en-NG")} payment from ${booking.client}`);
      showToast(`✓ Payment recorded for ${booking.client}`, "success");
    },
    [bookingUpdates, persistBookings, logActivity, showToast]
  );

  const deleteBookingUpdate = useCallback(
    (index: number) => {
      const next = bookingUpdates.filter((_, i) => i !== index);
      persistBookings(next);
      logActivity("DELETE_BOOKING", "Deleted a booking record");
      showToast("Booking deleted", "warn");
    },
    [bookingUpdates, persistBookings, logActivity, showToast]
  );

  // ─── GOALS ───
  const setGoal = useCallback(
    (period: keyof SalesGoals, value: number) => {
      const next = { ...salesGoals, [period]: value };
      persistGoals(next);
      showToast(`✓ ${period.charAt(0).toUpperCase() + period.slice(1)} goal set: ₦${value.toLocaleString("en-NG")}`, "success");
    },
    [salesGoals, persistGoals, showToast]
  );

  // ─── STAFF / USERS ───
  const addStaffMember = useCallback(
    (input: { name: string; username: string; password: string; role: string; phone?: string; email?: string }) => {
      if (!input.name || !input.username || !input.password) {
        showToast("Please fill all required fields", "warn");
        return false;
      }
      if (allUsers.find((u) => u.username === input.username)) {
        showToast("Username already exists", "warn");
        return false;
      }
      const newUser: AppUser = {
        id: Math.max(0, ...allUsers.map((u) => u.id)) + 1,
        username: input.username,
        password: input.password,
        name: input.name,
        role: input.role as AppUser["role"],
        permissions: isAdminRole(input.role)
          ? ["view_all", "manage_users", "manage_balances", "view_analytics", "edit_clients", "delete_bookings"]
          : STAFF_PERMISSIONS,
        status: "active",
        createdAt: new Date().toISOString(),
        phone: input.phone,
        email: input.email,
      };
      persistUsers([...allUsers, newUser]);
      logActivity("CREATE_STAFF", `Added staff member: ${newUser.name}`);
      showToast(`✓ Staff member added: ${newUser.name}`, "success");
      return true;
    },
    [allUsers, persistUsers, logActivity, showToast]
  );

  const updateStaffContact = useCallback(
    (userId: number, phone: string, email: string) => {
      const next = allUsers.map((u) => (u.id === userId ? { ...u, phone, email } : u));
      persistUsers(next);
      showToast("✓ Contact info updated", "success");
    },
    [allUsers, persistUsers, showToast]
  );

  const toggleUserStatus = useCallback(
    (userId: number) => {
      const next = allUsers.map((u) => (u.id === userId ? { ...u, status: (u.status === "active" ? "inactive" : "active") as AppUser["status"] } : u));
      persistUsers(next);
      logActivity("TOGGLE_USER_STATUS", `Toggled status for user ${userId}`);
      showToast("✓ User status updated", "success");
    },
    [allUsers, persistUsers, logActivity, showToast]
  );

  const deleteUser = useCallback(
    (userId: number) => {
      const user = allUsers.find((u) => u.id === userId);
      if (!user) return;
      persistUsers(allUsers.filter((u) => u.id !== userId));
      logActivity("DELETE_USER", `Deleted user: ${user.name}`);
      showToast(`✓ User deleted: ${user.name}`, "success");
    },
    [allUsers, persistUsers, logActivity, showToast]
  );

  const updateUserPermission = useCallback(
    (userId: number, permission: string, checked: boolean) => {
      const next = allUsers.map((u) => {
        if (u.id !== userId) return u;
        const perms = checked ? Array.from(new Set([...u.permissions, permission])) : u.permissions.filter((p) => p !== permission);
        return { ...u, permissions: perms };
      });
      persistUsers(next);
      logActivity("UPDATE_PERMISSION", `Updated permissions for user ${userId}`);
      showToast("✓ Permissions updated", "success");
    },
    [allUsers, persistUsers, logActivity, showToast]
  );

  const createNewUser = useCallback(
    (input: { username: string; password: string; name: string; role: string }) => {
      if (!input.username || !input.password || !input.name) {
        showToast("Please fill all fields", "warn");
        return false;
      }
      if (input.password.length < 6) {
        showToast("Password must be at least 6 characters", "warn");
        return false;
      }
      if (allUsers.find((u) => u.username === input.username)) {
        showToast("Username already exists", "warn");
        return false;
      }
      const newUser: AppUser = {
        id: Math.max(0, ...allUsers.map((u) => u.id)) + 1,
        username: input.username,
        password: input.password,
        name: input.name,
        role: input.role as AppUser["role"],
        permissions: isAdminRole(input.role)
          ? ["view_all", "manage_users", "manage_balances", "view_analytics", "edit_clients", "delete_bookings"]
          : STAFF_PERMISSIONS,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      persistUsers([...allUsers, newUser]);
      logActivity("CREATE_USER", `Created new user: ${newUser.name}`);
      showToast(`✓ User created: ${newUser.name}`, "success");
      return true;
    },
    [allUsers, persistUsers, logActivity, showToast]
  );

  // ─── DEBT TRACKER ───
  const addDebtGroup = useCallback(
    (name: string, initialBill: number) => {
      if (debtGroups.some((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase())) {
        showToast("A group with this name already exists", "warn");
        return false;
      }
      const newGroup: DebtGroup = { id: uid("dg"), name, initialBill, transactions: [], createdAt: new Date().toISOString() };
      persistDebtGroups([...debtGroups, newGroup]);
      showToast("✓ Client group added", "success");
      return true;
    },
    [debtGroups, persistDebtGroups, showToast]
  );

  const addDebtTransaction = useCallback(
    (groupId: string, desc: string, amount: number, type: "charge" | "payment", status: "pending" | "paid") => {
      const next = debtGroups.map((g) => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          transactions: [...g.transactions, { id: uid("tx"), date: formatDateTime(), desc, amount, type, status }],
        };
      });
      persistDebtGroups(next);
      showToast("✓ Transaction saved", "success");
    },
    [debtGroups, persistDebtGroups, showToast]
  );

  const markDebtTxPaid = useCallback(
    (groupId: string, txId: string) => {
      const next = debtGroups.map((g) =>
        g.id !== groupId ? g : { ...g, transactions: g.transactions.map((t) => (t.id === txId ? { ...t, status: "paid" as const } : t)) }
      );
      persistDebtGroups(next);
      showToast("✓ Marked as paid", "success");
    },
    [debtGroups, persistDebtGroups, showToast]
  );

  const deleteDebtTx = useCallback(
    (groupId: string, txId: string) => {
      const next = debtGroups.map((g) => (g.id !== groupId ? g : { ...g, transactions: g.transactions.filter((t) => t.id !== txId) }));
      persistDebtGroups(next);
      showToast("Transaction deleted", "warn");
    },
    [debtGroups, persistDebtGroups, showToast]
  );

  const deleteDebtGroup = useCallback(
    (groupId: string) => {
      persistDebtGroups(debtGroups.filter((g) => g.id !== groupId));
      showToast("Group deleted", "warn");
    },
    [debtGroups, persistDebtGroups, showToast]
  );

  // ─── SETTINGS / ADMIN ───
  const updateSettings = useCallback(
    (patch: Partial<SystemSettings>) => {
      const next = { ...settings, ...patch };
      persistSettings(next);
      showToast("✓ Settings saved", "success");
    },
    [settings, persistSettings, showToast]
  );

  const runBulkAction = useCallback(
    (action: string) => {
      if (action === "cancel-pending") {
        const next = bookingUpdates.map((b) => (b.status === "Pending" ? { ...b, status: "Cancelled" as const, updated: formatDateTime() } : b));
        persistBookings(next);
        logActivity("BULK_ACTION", "Cancelled all pending bookings");
        showToast("✓ All pending bookings cancelled", "success");
      } else if (action === "clear-cancelled") {
        const next = bookingUpdates.filter((b) => b.status !== "Cancelled");
        persistBookings(next);
        logActivity("BULK_ACTION", "Deleted all cancelled bookings");
        showToast("✓ Cancelled bookings removed", "success");
      } else {
        showToast("Select an action first", "warn");
      }
    },
    [bookingUpdates, persistBookings, logActivity, showToast]
  );

  const resetData = useCallback(
    (type: "bookings" | "clients" | "balances" | "logs") => {
      if (type === "bookings") persistBookings([]);
      if (type === "clients") persistClients([]);
      if (type === "balances") persistBalances(balances.map((b) => ({ ...b, balance: 0, updated: formatDateTime() })));
      if (type === "logs") {
        setSystemLogs([]);
        writeLS("tdis_systemLogs", []);
      }
      logActivity("RESET_DATA", `Reset data: ${type}`);
      showToast(`✓ ${type} data reset`, "success");
    },
    [balances, persistBookings, persistClients, persistBalances, logActivity, showToast]
  );

  const value = useMemo<AppState>(
    () => ({
      currentUser,
      authReady,
      login,
      signup,
      logout,
      hasPermission,
      balances,
      clients,
      bookingUpdates,
      deposits,
      allUsers,
      systemLogs,
      salesGoals,
      debtGroups,
      settings,
      updateBalance,
      addDeposit,
      addClient,
      saveBookingUpdate,
      updateClientPayment,
      deleteBookingUpdate,
      setGoal,
      addStaffMember,
      updateStaffContact,
      toggleUserStatus,
      deleteUser,
      updateUserPermission,
      createNewUser,
      addDebtGroup,
      addDebtTransaction,
      markDebtTxPaid,
      deleteDebtTx,
      deleteDebtGroup,
      updateSettings,
      runBulkAction,
      resetData,
      logActivity,
      toasts,
      showToast,
    }),
    [
      currentUser,
      authReady,
      login,
      signup,
      logout,
      hasPermission,
      balances,
      clients,
      bookingUpdates,
      deposits,
      allUsers,
      systemLogs,
      salesGoals,
      debtGroups,
      settings,
      updateBalance,
      addDeposit,
      addClient,
      saveBookingUpdate,
      updateClientPayment,
      deleteBookingUpdate,
      setGoal,
      addStaffMember,
      updateStaffContact,
      toggleUserStatus,
      deleteUser,
      updateUserPermission,
      createNewUser,
      addDebtGroup,
      addDebtTransaction,
      markDebtTxPaid,
      deleteDebtTx,
      deleteDebtGroup,
      updateSettings,
      runBulkAction,
      resetData,
      logActivity,
      toasts,
      showToast,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Re-export small pure helpers used across sections so they read from a
// single source of truth for client financials.
export function getClientTotalSpent(bookingUpdates: BookingUpdate[], clientName: string): number {
  return bookingUpdates.filter((b) => b.client === clientName).reduce((s, b) => s + b.amount, 0);
}
export function getClientAmountOwed(bookingUpdates: BookingUpdate[], clientName: string): number {
  return bookingUpdates
    .filter((b) => b.client === clientName)
    .reduce((sum, b) => {
      if (b.status === "Cancelled") return sum;
      const paid = b.amountPaid != null ? b.amountPaid : b.status === "Paid" ? b.amount : 0;
      return sum + Math.max(0, b.amount - paid);
    }, 0);
}
export function getGroupBalance(group: DebtGroup): number {
  return group.transactions.reduce((sum, t) => {
    if (t.status === "paid") return sum;
    return t.type === "charge" ? sum + t.amount : sum - t.amount;
  }, group.initialBill);
}

// Exported so modal components can generate today's date/time defaults.
export { todayISO, nowTime };
