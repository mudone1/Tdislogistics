"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/lib/store";

export default function ToastArea() {
  const { toasts } = useApp();
  return (
    <div className="toast-area">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast ${t.type === "success" ? "success" : "warn"}`}
            initial={{ opacity: 0, x: 60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.9 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>{t.type === "success" ? "✓" : "⚠"}</span>
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
