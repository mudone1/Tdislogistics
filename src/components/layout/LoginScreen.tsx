"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { LOCAL_CREDENTIALS } from "@/lib/constants";

export default function LoginScreen() {
  const { login, signup } = useApp();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole, setSignupRole] = useState("agent");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const ok = await login(loginEmail, loginPassword);
    setLoading(false);
    if (!ok) setError("Invalid email or password. Please try again.");
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (signupPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    const ok = await signup(signupName, signupEmail, signupPassword, signupRole);
    setLoading(false);
    if (!ok) setError("An account with this email already exists.");
  }

  async function demoLogin(kind: "admin" | "agent1") {
    setError("");
    setLoading(true);
    const cred = kind === "admin" ? LOCAL_CREDENTIALS[0] : LOCAL_CREDENTIALS[1];
    const ok = await login(cred.email, cred.password);
    setLoading(false);
    if (!ok) setError("Demo login failed.");
  }

  return (
    <div className="login-overlay">
      <motion.div
        className="login-container"
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <div className="login-header">
          <div className="login-logo">🛫 TDIS</div>
          <div className="login-subtitle">Logistics Agent Dashboard</div>
        </div>

        {error && <div className="login-error show">{error}</div>}

        {mode === "login" ? (
          <form className="login-form" onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email"
              required
              autoComplete="off"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              required
              autoComplete="off"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? "Logging in…" : "Login →"}
            </button>
            <p style={{ textAlign: "center", marginTop: 15, fontSize: 14 }}>
              Don&apos;t have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); setError(""); }} style={{ color: "var(--gold)", cursor: "pointer" }}>
                Sign up
              </a>
            </p>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleSignup}>
            <input
              type="text"
              placeholder="Full Name"
              required
              autoComplete="off"
              value={signupName}
              onChange={(e) => setSignupName(e.target.value)}
            />
            <input
              type="email"
              placeholder="Email"
              required
              autoComplete="off"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password (min 6 chars)"
              required
              autoComplete="off"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
            />
            <select value={signupRole} onChange={(e) => setSignupRole(e.target.value)}>
              <option value="agent">Staff Agent</option>
              <option value="manager">Operational Manager</option>
              <option value="independent">TDIS Independent Agent</option>
              <option value="frontdesk">Front Desk Staff</option>
            </select>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? "Creating account…" : "Create Account →"}
            </button>
            <p style={{ textAlign: "center", marginTop: 15, fontSize: 14 }}>
              Already have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setError(""); }} style={{ color: "var(--gold)", cursor: "pointer" }}>
                Login
              </a>
            </p>
          </form>
        )}

        <div className="demo-link">
          <p style={{ marginBottom: 10, fontSize: 12 }}>Test Accounts (will be deprecated):</p>
          <button type="button" onClick={() => demoLogin("admin")} style={{ fontSize: 12 }}>
            Admin Demo
          </button>{" "}
          ·{" "}
          <button type="button" onClick={() => demoLogin("agent1")} style={{ fontSize: 12 }}>
            Agent Demo
          </button>
        </div>
      </motion.div>
    </div>
  );
}
