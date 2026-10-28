export type WmsToastType = "success" | "error" | "warning" | "info";
export type WmsToast = {
  id: number;
  type: WmsToastType;
  title: string;
  message?: string;
};
export type WmsConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};
export type WmsConfirmRequest = {
  options: WmsConfirmOptions;
  resolve: (value: boolean) => void;
};

type ToastListener = (toast: WmsToast) => void;
let nextToastId = 0;
const toastListeners = new Set<ToastListener>();
let confirmListener: ((request: WmsConfirmRequest) => void) | null = null;

function emit(type: WmsToastType, title: string, message?: string): void {
  const toast: WmsToast = { id: ++nextToastId, type, title, message };
  toastListeners.forEach((listener) => listener(toast));
}

export const wmsToast = {
  success: (title: string, message?: string) => emit("success", title, message),
  error: (title: string, message?: string) => emit("error", title, message),
  warning: (title: string, message?: string) => emit("warning", title, message),
  info: (title: string, message?: string) => emit("info", title, message)
};

export function subscribeWmsToasts(listener: ToastListener): () => void {
  toastListeners.add(listener);
  return () => { toastListeners.delete(listener); };
}

export function subscribeWmsConfirm(
  listener: (request: WmsConfirmRequest) => void
): () => void {
  confirmListener = listener;
  return () => {
    if (confirmListener === listener) confirmListener = null;
  };
}

export function wmsConfirm(options: WmsConfirmOptions): Promise<boolean> {
  // Never execute a sensitive action if its confirmation UI is not mounted.
  if (!confirmListener) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    confirmListener?.({ options, resolve });
  });
}