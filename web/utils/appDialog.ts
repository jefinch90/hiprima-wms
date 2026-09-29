"use client";

type DialogTone =
  | "default"
  | "success"
  | "danger";

type DialogOptions = {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
};

function showDialog(
  message: string,
  isConfirm: boolean,
  options: DialogOptions = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(!isConfirm);
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    const overlay =
      document.createElement("div");

    overlay.className =
      "fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]";

    const card =
      document.createElement("div");

    card.className =
      "w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl";

    const title =
      document.createElement("div");

    title.className =
      "text-lg font-bold text-slate-900";

    title.textContent =
      options.title ??
      (isConfirm
        ? "Konfirmasi"
        : "Hi.PRIMA WMS");

    const body =
      document.createElement("div");

    body.className =
      "mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600";

    body.textContent =
      message;

    const actions =
      document.createElement("div");

    actions.className =
      "mt-6 flex justify-end gap-3";

    const cleanup = (
      result: boolean
    ) => {
      document.removeEventListener(
        "keydown",
        handleKeydown
      );

      document.body.style.overflow =
        previousOverflow;

      overlay.remove();

      resolve(result);
    };

    const handleKeydown = (
      event: KeyboardEvent
    ) => {
      if (
        event.key === "Escape"
      ) {
        cleanup(
          isConfirm
            ? false
            : true
        );
      }

      if (
        event.key === "Enter" &&
        !isConfirm
      ) {
        cleanup(true);
      }
    };

    if (isConfirm) {
      const cancelButton =
        document.createElement(
          "button"
        );

      cancelButton.type =
        "button";

      cancelButton.className =
        "min-w-24 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50";

      cancelButton.textContent =
        options.cancelText ??
        "Batal";

      cancelButton.onclick =
        () => cleanup(false);

      actions.appendChild(
        cancelButton
      );
    }

    const confirmButton =
      document.createElement(
        "button"
      );

    confirmButton.type =
      "button";

    const tone =
      options.tone ??
      "default";

    confirmButton.className =
      tone === "danger"
        ? "min-w-24 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
        : tone === "success"
          ? "min-w-24 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          : "min-w-24 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800";

    confirmButton.textContent =
      options.confirmText ??
      "OK";

    confirmButton.onclick =
      () => cleanup(true);

    actions.appendChild(
      confirmButton
    );

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(actions);

    overlay.appendChild(card);
    document.body.appendChild(
      overlay
    );

    document.addEventListener(
      "keydown",
      handleKeydown
    );

    window.setTimeout(
      () =>
        confirmButton.focus(),
      0
    );
  });
}

export function appAlert(
  message: string,
  options?: DialogOptions
) {
  return showDialog(
    message,
    false,
    options
  );
}

export function appConfirm(
  message: string,
  options?: DialogOptions
) {
  return showDialog(
    message,
    true,
    options
  );
}
