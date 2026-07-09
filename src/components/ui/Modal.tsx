"use client";

// Built on Radix's Dialog primitive — the same accessible, unstyled
// foundation shadcn/ui's <Dialog> generates — restyled with the app's
// original .modal-overlay / .modal classes so focus-trapping, ESC-to-close,
// and scroll-locking come for free while the visual design stays identical.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="modal-overlay show"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <DialogPrimitive.Content asChild forceMount onOpenAutoFocus={(e) => e.preventDefault()}>
                  <motion.div
                    className="modal"
                    style={maxWidth ? { maxWidth } : undefined}
                    initial={{ opacity: 0, scale: 0.88, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 10 }}
                    transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                  >
                    <div className="modal-header">
                      <DialogPrimitive.Title className="modal-title" asChild>
                        <span>{title}</span>
                      </DialogPrimitive.Title>
                      <DialogPrimitive.Close asChild>
                        <button className="modal-close" aria-label="Close">
                          ✕
                        </button>
                      </DialogPrimitive.Close>
                    </div>
                    <div className="modal-body">{children}</div>
                    {footer && <div className="modal-footer">{footer}</div>}
                  </motion.div>
                </DialogPrimitive.Content>
              </motion.div>
            </DialogPrimitive.Overlay>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
