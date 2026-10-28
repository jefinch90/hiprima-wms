"use client";

import { useEffect, useRef, useState } from "react";
import {
  subscribeWmsConfirm,
  subscribeWmsToasts,
  type WmsConfirmRequest,
  type WmsToast,
  type WmsToastType
} from "@/utils/wmsNotifications";

const toneClasses: Record<WmsToastType, string> = {
  success: "border-emerald-200 bg-white text-emerald-700",
  error: "border-rose-200 bg-white text-rose-700",
  warning: "border-amber-200 bg-white text-amber-700",
  info: "border-sky-200 bg-white text-sky-700"
};
const symbols: Record<WmsToastType, string> = {
  success: "✓", error: "!", warning: "!", info: "i"
};

export default function WmsNotificationCenter() {
  const [toasts, setToasts] = useState<WmsToast[]>([]);
  const [confirmation, setConfirmation] = useState<WmsConfirmRequest | null>(null);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const activeTimers = timers.current;
    const unsubscribeToasts = subscribeWmsToasts((toast) => {
      setToasts((previous) => [...previous.slice(-3), toast]);
      // Errors and warnings stay until dismissed to allow users to read them.
      if (toast.type === "success" || toast.type === "info") {
        const timer = setTimeout(() => {
          setToasts((previous) => previous.filter((item) => item.id !== toast.id));
          activeTimers.delete(toast.id);
        }, 4200);
        activeTimers.set(toast.id, timer);
      }
    });
    const unsubscribeConfirm = subscribeWmsConfirm((request) => {
      setConfirmation((old) => {
        if (old) old.resolve(false);
        return request;
      });
    });
    return () => {
      unsubscribeToasts();
      unsubscribeConfirm();
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const dismissToast = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((previous) => previous.filter((item) => item.id !== id));
  };

  const settleConfirm = (accepted: boolean) => {
    if (!confirmation) return;
    confirmation.resolve(accepted);
    setConfirmation(null);
  };

  return (
    <>
      <div className="pointer-events-none fixed right-3 top-4 z-[100] flex w-[min(420px,calc(100vw-24px))] flex-col gap-2 sm:right-5" aria-live="polite">
        {toasts.map((toast) => (
          <section
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg ${toneClasses[toast.type]}`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base font-bold" aria-hidden="true">
              {symbols[toast.type]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900">{toast.title}</p>
              {toast.message && <p className="mt-1 break-words text-xs leading-5 text-slate-600">{toast.message}</p>}
            </div>
            <button type="button" aria-label="Tutup notifikasi" onClick={() => dismissToast(toast.id)} className="shrink-0 rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">×</button>
          </section>
        ))}
      </div>
      {confirmation && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="wms-confirm-title" aria-describedby="wms-confirm-desc" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="wms-confirm-title" className="text-lg font-bold text-slate-900">{confirmation.options.title}</h2>
            <p id="wms-confirm-desc" className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{confirmation.options.message}</p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => settleConfirm(false)} autoFocus className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {confirmation.options.cancelLabel ?? "Batal"}
              </button>
              <button type="button" onClick={() => settleConfirm(true)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${confirmation.options.tone === "danger" ? "bg-rose-700 hover:bg-rose-800" : "bg-slate-900 hover:bg-slate-700"}`}>
                {confirmation.options.confirmLabel ?? "Ya, Lanjutkan"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}