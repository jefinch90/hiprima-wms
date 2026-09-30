"use client";

import {
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createClient } from "@/utils/supabase/client";

export type CycleVarianceLine = {
  line_id: string;
  sku: string;
  variant_id: string;
  location_id: string;
  system_qty: number;
  counted_qty: number | null;
  recount_qty: number | null;
  variance_reason_category?: string | null;
  investigation_notes?: string | null;
};

const CATEGORIES = [
  ["misplaced_stock", "Stok salah lokasi"],
  ["unrecorded_movement", "Perpindahan belum tercatat"],
  ["damaged_or_lost", "Rusak atau hilang"],
  ["receiving_error", "Kesalahan penerimaan"],
  ["picking_packing_error", "Kesalahan picking/packing"],
  ["other", "Lainnya"],
] as const;

type EditorState = {
  recount: string;
  category: string;
  notes: string;
  saving: boolean;
  error: string;
};

/*
 * Satu store di level module.
 *
 * Counting/Review saat ini dapat merender editor yang sama lebih dari sekali
 * untuk layout desktop dan mobile. Bila masing-masing instance memakai
 * useState sendiri, draft yang belum disimpan dapat berbeda/hilang ketika
 * breakpoint berubah.
 *
 * Store ini membuat semua instance dengan key yang sama membaca draft,
 * status saving, dan error yang sama.
 */
const editorStateStore = new Map<string, EditorState>();
const editorStateListeners = new Map<string, Set<() => void>>();

function getEditorState(key: string, initialState: EditorState) {
  const current = editorStateStore.get(key);

  if (current) {
    return current;
  }

  editorStateStore.set(key, initialState);
  return initialState;
}

function subscribeEditorState(key: string, listener: () => void) {
  let listeners = editorStateListeners.get(key);

  if (!listeners) {
    listeners = new Set();
    editorStateListeners.set(key, listeners);
  }

  listeners.add(listener);

  return () => {
    const currentListeners = editorStateListeners.get(key);
    currentListeners?.delete(listener);

    if (currentListeners?.size === 0) {
      editorStateListeners.delete(key);
    }
  };
}

function updateEditorState(
  key: string,
  initialState: EditorState,
  patch: Partial<EditorState>,
) {
  const current = getEditorState(key, initialState);
  const next = { ...current, ...patch };

  if (
    current.recount === next.recount &&
    current.category === next.category &&
    current.notes === next.notes &&
    current.saving === next.saving &&
    current.error === next.error
  ) {
    return;
  }

  editorStateStore.set(key, next);
  editorStateListeners.get(key)?.forEach((listener) => listener());
}

function useSharedEditorState(
  key: string,
  initialState: EditorState,
) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeEditorState(key, listener),
    [key],
  );

  const getSnapshot = useCallback(
    () => getEditorState(key, initialState),
    [key, initialState],
  );

  const getServerSnapshot = useCallback(
    () => initialState,
    [initialState],
  );

  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setState = useCallback(
    (patch: Partial<EditorState>) => {
      updateEditorState(key, initialState, patch);
    },
    [key, initialState],
  );

  return [state, setState] as const;
}

export default function CycleCountVarianceEditor({
  line,
  sessionId,
  editable,
  onChanged,
}: {
  line: CycleVarianceLine;
  sessionId: string;
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);

  /*
   * Persisted values ikut menjadi bagian key.
   * Setelah save + reload dari DB, editor mendapat key baru dan kembali
   * menggunakan nilai database sebagai source of truth.
   *
   * Selama data DB belum berubah, desktop/mobile memakai key yang sama,
   * sehingga draft belum disimpan tetap sinkron.
   */
  const editorKey = useMemo(
    () =>
      JSON.stringify([
        sessionId,
        line.line_id,
        line.recount_qty,
        line.variance_reason_category ?? "",
        line.investigation_notes ?? "",
      ]),
    [
      sessionId,
      line.line_id,
      line.recount_qty,
      line.variance_reason_category,
      line.investigation_notes,
    ],
  );

  const initialState = useMemo<EditorState>(
    () => ({
      recount:
        line.recount_qty === null
          ? ""
          : String(line.recount_qty),
      category: line.variance_reason_category ?? "",
      notes: line.investigation_notes ?? "",
      saving: false,
      error: "",
    }),
    [
      line.recount_qty,
      line.variance_reason_category,
      line.investigation_notes,
    ],
  );

  const [editorState, setEditorState] = useSharedEditorState(
    editorKey,
    initialState,
  );

  const {
    recount,
    category,
    notes,
    saving,
    error,
  } = editorState;

  if (
    line.counted_qty === null ||
    (
      line.counted_qty === line.system_qty &&
      (
        line.recount_qty === null ||
        line.recount_qty === line.system_qty
      )
    )
  ) {
    return null;
  }

  const needsReason =
    line.recount_qty !== null &&
    line.recount_qty !== line.system_qty;

  const savedReason = Boolean(
    line.variance_reason_category &&
    line.investigation_notes?.trim() &&
    category === line.variance_reason_category &&
    notes.trim() === line.investigation_notes.trim(),
  );

  async function saveRecount() {
    const qty = Number(recount);

    if (
      recount.trim() === "" ||
      !Number.isSafeInteger(qty) ||
      qty < 0
    ) {
      setEditorState({
        error: "Recount wajib angka bulat 0 atau lebih.",
      });
      return;
    }

    if (qty === line.recount_qty) {
      return;
    }

    setEditorState({
      saving: true,
      error: "",
    });

    const { error: rpcError } = await supabase.rpc(
      "save_stock_opname_recount",
      {
        p_session_id: sessionId,
        p_variant_id: line.variant_id,
        p_location_id: line.location_id,
        p_recount_qty: qty,
      },
    );

    if (rpcError) {
      setEditorState({
        saving: false,
        error: rpcError.message,
      });
      return;
    }

    try {
      await onChanged();
      setEditorState({
        saving: false,
        error: "",
      });
    } catch {
      setEditorState({
        saving: false,
        error: "Recount tersimpan, tetapi pembaruan layar gagal.",
      });
    }
  }

  async function saveReason() {
    if (!category || !notes.trim()) {
      setEditorState({
        error:
          "Kategori Alasan Selisih dan Catatan Investigasi wajib diisi.",
      });
      return;
    }

    if (notes.trim().length > 1000) {
      setEditorState({
        error: "Catatan Investigasi maksimal 1000 karakter.",
      });
      return;
    }

    setEditorState({
      saving: true,
      error: "",
    });

    const { error: rpcError } = await supabase.rpc(
      "save_cycle_count_variance_reason",
      {
        p_line_id: line.line_id,
        p_category: category,
        p_notes: notes.trim(),
      },
    );

    if (rpcError) {
      setEditorState({
        saving: false,
        error: rpcError.message,
      });
      return;
    }

    try {
      await onChanged();
      setEditorState({
        saving: false,
        error: "",
      });
    } catch {
      setEditorState({
        saving: false,
        error:
          "Alasan tersimpan, tetapi pembaruan layar gagal.",
      });
    }
  }

  return (
    <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left sm:p-4">
      <p className="text-sm font-semibold text-amber-900">
        Investigasi selisih · {line.sku}
      </p>

      <p className="mt-1 text-xs text-amber-800">
        System {line.system_qty} · First Count {line.counted_qty}
        {line.recount_qty !== null &&
          ` · Recount ${line.recount_qty}`}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-700">
          {line.counted_qty === line.system_qty
            ? "Recount sebelumnya"
            : "Recount wajib"}

          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={recount}
            onChange={(event) =>
              setEditorState({
                recount: event.target.value,
                error: "",
              })
            }
            disabled={!editable || saving}
            className="mt-1 block h-10 w-32 rounded-lg border border-amber-300 bg-white px-3 text-right text-sm font-bold disabled:bg-slate-100"
          />
        </label>

        {editable && (
          <button
            type="button"
            onClick={saveRecount}
            disabled={
              saving ||
              recount.trim() === "" ||
              Number(recount) === line.recount_qty
            }
            className="h-10 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Menyimpan..." : "Simpan Recount"}
          </button>
        )}

        {line.recount_qty === line.system_qty && (
          <span className="text-xs font-semibold text-emerald-700">
            Match setelah Recount ✓
          </span>
        )}
      </div>

      {needsReason && (
        <div className="mt-4 grid min-w-0 gap-3 border-t border-amber-200 pt-4 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold text-slate-700">
            Kategori Alasan Selisih *

            <select
              value={category}
              onChange={(event) =>
                setEditorState({
                  category: event.target.value,
                  error: "",
                })
              }
              disabled={!editable || saving}
              className="mt-1 block h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
            >
              <option value="">Pilih kategori</option>

              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 text-xs font-semibold text-slate-700">
            Catatan Investigasi *

            <textarea
              value={notes}
              onChange={(event) =>
                setEditorState({
                  notes: event.target.value,
                  error: "",
                })
              }
              disabled={!editable || saving}
              maxLength={1000}
              rows={3}
              placeholder="Jelaskan hasil pemeriksaan selisih..."
              className="mt-1 block w-full min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            {editable && (
              <button
                type="button"
                onClick={saveReason}
                disabled={
                  saving ||
                  !category ||
                  !notes.trim()
                }
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {saving
                  ? "Menyimpan..."
                  : savedReason
                    ? "Perbarui Alasan"
                    : "Simpan Alasan"}
              </button>
            )}

            {savedReason && (
              <span className="text-xs font-semibold text-emerald-700">
                Alasan tersimpan ✓
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 text-xs font-medium text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
