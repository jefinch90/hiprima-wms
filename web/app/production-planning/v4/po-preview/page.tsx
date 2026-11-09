"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type Batch = {
  id: string;
  status: string;
  created_at: string;
};

type ApprovalRequest = {
  id: string;
  batch_id: string;
  requested_by: string;
  requested_at: string;
  status: string;
};

type ReviewLine = {
  batch_id: string;
  variant_id: string;
  sku_snapshot: string | null;
  product_code: string | null;
  vendor_name_snapshot: string | null;
  proposed_qty: number | null;
  decision: string;
  moq_type: string | null;
  moq_quantity: number | null;
};

type Variant = {
  id: string;
  product_id: string;
  color: string | null;
  hpp: number | string | null;
  cost_price: number | string | null;
};

type HppHistoryRow = {
  variant_id: string;
  hpp: number | string | null;
  created_at: string;
  effective_from: string;
  effective_to: string | null;
  change_type: string | null;
};

type HppReference = {
  hpp: number | null;
  costPrice: number | null;
  latestHistoryHpp: number | null;
  historyEntryFound: boolean;
  historyAt: string | null;
  historyReadError: boolean;
};

type HppEvaluation = {
  reference: HppReference | null;
  masterAvailable: boolean;
  masterProblematic: boolean;
  subtotal: number | null;
  consistencyStatus: string;
  source: string;
  conflict: boolean;
};

type Product = {
  id: string;
  product_code: string | null;
  name: string | null;
};

type VendorCandidate = {
  parameter_id: string;
  candidate_master_id: string | null;
  product_code: string | null;
  lead_time_days: number | null;
  moq_type: string | null;
  moq_quantity: number | null;
  review_status: string;
  master_match_count: number;
  master_mapping_status: string;
};

type VendorParameter = {
  id: string;
  vendor_id: string;
};

type Vendor = {
  id: string;
  vendor_name: string;
  is_active: boolean;
};

type VerifiedVendor = {
  vendorId: string;
  vendorName: string;
  leadTimeDays: number | null;
};

type Readiness = {
  batch_id: string;
  mode: string;
  approval_enabled: boolean;
  po_generation_enabled: boolean;
  as_of_date: string;
  sales: {
    fresh: boolean;
    age_days: number | null;
    last_sale_date: string | null;
  };
};

type PreviewGroup = {
  id: string;
  name: string;
  vendor: VerifiedVendor | null;
  lines: ReviewLine[];
};

const numberFormat = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 2,
});

function formatNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : numberFormat.format(Number(value));
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 2,
  }).format(value);
}

function parseHpp(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateHpp(
  line: ReviewLine,
  references: Record<string, HppReference>
): HppEvaluation {
  const reference = references[line.variant_id] ?? null;
  const hpp = reference?.hpp ?? null;
  const conflict =
    !!reference &&
    ((reference.costPrice != null && reference.costPrice !== hpp) ||
      (reference.historyEntryFound &&
        (reference.latestHistoryHpp == null ||
          reference.latestHistoryHpp !== hpp)));
  const valid =
    !!reference &&
    hpp != null &&
    hpp > 0 &&
    hpp <= Number.MAX_SAFE_INTEGER &&
    !conflict &&
    !reference.historyReadError;
  const qty = Number(line.proposed_qty);
  const subtotal =
    valid && hpp != null && Number.isSafeInteger(qty) && qty > 0
      ? qty * hpp
      : null;
  const subtotalInvalid = subtotal != null && !Number.isFinite(subtotal);
  const masterAvailable =
    !!reference &&
    hpp != null &&
    hpp > 0 &&
    hpp <= Number.MAX_SAFE_INTEGER;
  const consistencyStatus = !reference
    ? "Tidak dapat diperiksa"
    : conflict
      ? "Tidak konsisten dengan sumber HPP lain"
      : reference.historyReadError
        ? "Tidak dapat diverifikasi — riwayat gagal dibaca"
        : reference.historyEntryFound
          ? "Konsisten dengan riwayat yang tersedia"
          : "Belum dapat dikonfirmasi — riwayat tidak tersedia";
  return {
    reference,
    masterAvailable,
    masterProblematic:
      !masterAvailable || conflict || !!reference?.historyReadError,
    subtotal: subtotalInvalid ? null : subtotal,
    consistencyStatus,
    source: reference
      ? "product_variants.hpp"
      : "HPP Master tidak dapat dibaca",
    conflict,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  })} WIB`;
}

function wibDate() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function moqScope(value: string | null) {
  if (!value) return "Scope belum dicatat pada Draft";
  return value.replaceAll("_", " ");
}

function isAccessError(error: { code?: string; message?: string }) {
  return (
    error.code === "42501" ||
    /permission denied|row.level security|\brls\b/i.test(error.message ?? "")
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Kesalahan tidak diketahui.";
}

export default function ProductionOrderPreviewPage() {
  const router = useRouter();
  const db = useMemo(() => createClient(), []);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [requesterName, setRequesterName] = useState("");
  const [verifiedVendors, setVerifiedVendors] = useState<
    Record<string, VerifiedVendor>
  >({});
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [productIdByVariant, setProductIdByVariant] = useState<
    Record<string, string>
  >({});
  const [hppByVariant, setHppByVariant] = useState<
    Record<string, HppReference>
  >({});
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [approvalError, setApprovalError] = useState("");
  const [approvalUnavailable, setApprovalUnavailable] = useState(false);
  const [salesWarning, setSalesWarning] = useState("");
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pageError, setPageError] = useState("");
  const [ready, setReady] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    setPageError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await db.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("role,is_active")
        .eq("id", user.id)
        .single();
      if (profileError) throw profileError;
      if (
        !profile?.is_active ||
        !["owner", "admin", "warehouse_manager"].includes(String(profile.role))
      ) {
        throw new Error(
          "Akun tidak memiliki akses ke Preview Production Order."
        );
      }

      const { data, error } = await db
        .from("wms_production_review_batches")
        .select("id,status,created_at")
        .eq("status", "DRAFT")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        throw new Error(
          isAccessError(error)
            ? "Akses Draft ditolak oleh kebijakan database."
            : error.message
        );
      }

      const loaded = (data ?? []) as Batch[];
      const queryBatchId =
        typeof window === "undefined"
          ? ""
          : new URLSearchParams(window.location.search).get("batch") ?? "";
      let availableBatches = loaded;
      let initialBatch = loaded[0]?.id ?? "";
      if (queryBatchId) {
        const listedBatch = loaded.find((batch) => batch.id === queryBatchId);
        if (listedBatch) {
          initialBatch = listedBatch.id;
        } else {
          const { data: requestedBatch, error: requestedBatchError } = await db
            .from("wms_production_review_batches")
            .select("id,status,created_at")
            .eq("id", queryBatchId)
            .eq("status", "DRAFT")
            .maybeSingle();
          if (requestedBatchError) {
            throw new Error(
              isAccessError(requestedBatchError)
                ? "Draft yang diminta tidak dapat dibaca karena pembatasan akses."
                : requestedBatchError.message
            );
          }
          if (!requestedBatch) {
            throw new Error(
              "Draft yang diminta tidak tersedia atau statusnya bukan DRAFT."
            );
          }
          availableBatches = [requestedBatch as Batch, ...loaded];
          initialBatch = requestedBatch.id;
        }
      }
      setBatches(availableBatches);
      setSelectedBatchId(initialBatch);
      setReady(true);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setLoadingBatches(false);
    }
  }, [db, router]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      await Promise.resolve();
      if (active) void loadBatches();
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [loadBatches]);

  useEffect(() => {
    if (!ready || !selectedBatchId) return;

    let active = true;
    async function loadPreview() {
      setLoadingPreview(true);
      setPageError("");
      setPreviewLoaded(false);
      setApprovalError("");
      setApprovalUnavailable(false);
      setSalesWarning("");
      setDataWarnings([]);
      setSelectedBatch(null);
      setLines([]);
      setApproval(null);
      setRequesterName("");
      setVerifiedVendors({});
      setProducts({});
      setProductIdByVariant({});
      setHppByVariant({});
      setReadiness(null);

      try {
        const { data: batch, error: batchError } = await db
          .from("wms_production_review_batches")
          .select("id,status,created_at")
          .eq("id", selectedBatchId)
          .maybeSingle();
        if (batchError) {
          throw new Error(
            isAccessError(batchError)
              ? "Draft tidak dapat dibaca berdasarkan kebijakan akses."
              : batchError.message
          );
        }
        if (!batch || batch.status !== "DRAFT") {
          throw new Error(
            "Draft tidak tersedia atau statusnya bukan DRAFT. Preview dihentikan."
          );
        }
        if (active) setSelectedBatch(batch as Batch);

        const { data: savedLines, error: linesError } = await db
          .from("wms_production_review_lines")
          .select(
            "batch_id,variant_id,sku_snapshot,product_code,vendor_name_snapshot,proposed_qty,decision,moq_type,moq_quantity"
          )
          .eq("batch_id", selectedBatchId)
          .order("sku_snapshot", { ascending: true });
        if (linesError) {
          throw new Error(
            isAccessError(linesError)
              ? "Baris Draft tidak dapat dibaca; preview tidak ditampilkan."
              : linesError.message
          );
        }

        const draftLines = (savedLines ?? []) as ReviewLine[];
        if (
          draftLines.length === 0 ||
          draftLines.some((line) => line.batch_id !== selectedBatchId) ||
          new Set(draftLines.map((line) => line.variant_id)).size !==
            draftLines.length
        ) {
          throw new Error(
            "Baris Draft kosong, tidak cocok, atau memiliki SKU duplikat. Preview dihentikan."
          );
        }
        if (active) setLines(draftLines);

        let nextApproval: ApprovalRequest | null = null;
        const { data: requestRows, error: requestError } = await db
          .from("wms_sim_approval_requests")
          .select("id,batch_id,requested_by,requested_at,status")
          .eq("batch_id", selectedBatchId)
          .order("requested_at", { ascending: false });

        if (requestError) {
          if (active) {
            setApprovalUnavailable(true);
            setApprovalError(
              isAccessError(requestError)
                ? "Status Approval Simulasi tidak dapat diverifikasi karena akses database."
                : `Status Approval Simulasi gagal dimuat: ${requestError.message}`
            );
          }
        } else {
          const requests = (requestRows ?? []) as ApprovalRequest[];
          nextApproval = requests[0] ?? null;
          if (active) {
            setApproval(nextApproval);
            if (requests.length > 1) {
              setApprovalError(
                "Draft memiliki lebih dari satu pengajuan simulasi; status terbaru ditampilkan."
              );
            }
          }

          if (nextApproval?.requested_by) {
            const { data: requester, error: requesterError } = await db
              .from("profiles")
              .select("full_name")
              .eq("id", nextApproval.requested_by)
              .maybeSingle();
            if (requesterError) {
              if (active) {
                setDataWarnings((previous) => [
                  ...previous,
                  "Nama pengaju tidak dapat dibaca; identitas tidak dikarang.",
                ]);
              }
            } else if (active) {
              setRequesterName(requester?.full_name?.trim() ?? "");
            }
          }
        }

        const warnings: string[] = [];
        const proposedLines = draftLines.filter(
          (line) => line.decision === "PROPOSE"
        );
        const invalidQtyLines = proposedLines.filter((line) => {
          const qty = Number(line.proposed_qty);
          return !Number.isSafeInteger(qty) || qty <= 0;
        });
        if (invalidQtyLines.length > 0) {
          warnings.push(
            `${invalidQtyLines.length} Qty usulan tidak valid; total Qty ditandai tidak lengkap.`
          );
        }
        const invalidDecisionLines = draftLines.filter(
          (line) => !["PROPOSE", "HOLD", "EXCLUDE"].includes(line.decision)
        );
        if (invalidDecisionLines.length > 0) {
          warnings.push(
            `${invalidDecisionLines.length} keputusan SKU tidak dikenali.`
          );
        }
        const variantIds = [...new Set(proposedLines.map((line) => line.variant_id))];
        let variants: Variant[] = [];
        let productRows: Product[] = [];

        if (variantIds.length > 0) {
          const { data: variantRows, error: variantsError } = await db
            .from("product_variants")
            .select("id,product_id,color,hpp,cost_price")
            .in("id", variantIds);

          if (variantsError) {
            warnings.push(
              `Detail produk dan HPP Master gagal dimuat: ${variantsError.message}`
            );
          } else {
            variants = (variantRows ?? []) as Variant[];
            const { data: historyRows, error: historyError } = await db
              .from("product_variant_price_history")
              .select(
                "variant_id,hpp,created_at,effective_from,effective_to,change_type"
              )
              .in("variant_id", variantIds)
              .order("created_at", { ascending: false })
              .limit(500);
            const historyByVariant = new Map<string, HppHistoryRow>();
            if (historyError) {
              warnings.push(
                `Riwayat HPP tidak dapat dibaca: ${historyError.message}. HPP hanya ditampilkan sebagai referensi Master, bukan HPP terverifikasi.`
              );
            } else {
              for (const row of (historyRows ?? []) as HppHistoryRow[]) {
                if (!historyByVariant.has(row.variant_id)) {
                  historyByVariant.set(row.variant_id, row);
                }
              }
            }
            if (active) {
              setHppByVariant(
                Object.fromEntries(
                  variants.map((variant) => {
                    const latestHistory = historyByVariant.get(variant.id);
                    return [
                      variant.id,
                      {
                        hpp: parseHpp(variant.hpp),
                        costPrice: parseHpp(variant.cost_price),
                        latestHistoryHpp: parseHpp(latestHistory?.hpp),
                        historyEntryFound: !!latestHistory,
                        historyAt: latestHistory?.created_at ?? null,
                        historyReadError: !!historyError,
                      },
                    ];
                  })
                )
              );
              for (const variant of variants) {
                const masterHpp = parseHpp(variant.hpp);
                const costPrice = parseHpp(variant.cost_price);
                const latestHistoryHpp = parseHpp(
                  historyByVariant.get(variant.id)?.hpp
                );
                const sku =
                  proposedLines.find((line) => line.variant_id === variant.id)
                    ?.sku_snapshot ?? variant.id;
                if (
                  masterHpp != null &&
                  costPrice != null &&
                  masterHpp !== costPrice
                ) {
                  warnings.push(
                    `HPP Master dan cost_price berbeda untuk SKU ${sku}; subtotal tidak dihitung.`
                  );
                }
                if (
                  masterHpp != null &&
                  historyByVariant.has(variant.id) &&
                  (latestHistoryHpp == null || masterHpp !== latestHistoryHpp)
                ) {
                  warnings.push(
                    `HPP Master berbeda dari entri riwayat terbaru untuk SKU ${sku}; subtotal tidak dihitung sampai diverifikasi.`
                  );
                }
                if (!historyByVariant.has(variant.id)) {
                  warnings.push(
                    `Riwayat HPP belum tersedia untuk SKU ${sku}; nilai Master hanya menjadi referensi.`
                  );
                }
                if (masterHpp == null || masterHpp <= 0) {
                  warnings.push(`HPP perlu verifikasi untuk SKU ${sku}.`);
                }
              }
            }
            if (active) {
              setProductIdByVariant(
                Object.fromEntries(
                  variants.map((variant) => [
                    variant.id,
                    variant.product_id,
                  ])
                )
              );
            }
            const productIds = [
              ...new Set(variants.map((variant) => variant.product_id)),
            ];
            if (productIds.length > 0) {
              const { data: rows, error: productsError } = await db
                .from("products")
                .select("id,product_code,name")
                .in("id", productIds);
              if (productsError) {
                warnings.push(
                  `Nama produk dan kode Master gagal dimuat: ${productsError.message}`
                );
              } else {
                productRows = (rows ?? []) as Product[];
                if (active) {
                  setProducts(
                    Object.fromEntries(
                      productRows.map((product) => [product.id, product])
                    )
                  );
                }
              }

              const { data: candidateRows, error: candidateError } = await db
                .from("wms_vendor_product_candidates")
                .select(
                  "parameter_id,candidate_master_id,product_code,lead_time_days,moq_type,moq_quantity,review_status,master_match_count,master_mapping_status"
                )
                .in("candidate_master_id", productIds);

              if (candidateError) {
                warnings.push(
                  `Mapping vendor terverifikasi gagal dibaca: ${candidateError.message}`
                );
              } else {
                const candidates = (candidateRows ?? []) as VendorCandidate[];
                const candidatesByProduct = new Map<
                  string,
                  VendorCandidate[]
                >();
                for (const candidate of candidates) {
                  if (!candidate.candidate_master_id) continue;
                  candidatesByProduct.set(candidate.candidate_master_id, [
                    ...(candidatesByProduct.get(
                      candidate.candidate_master_id
                    ) ?? []),
                    candidate,
                  ]);
                }
                const uniqueVerifiedCandidates = [
                  ...candidatesByProduct.entries(),
                ]
                  .filter(
                    ([, productCandidates]) =>
                      productCandidates.length === 1 &&
                      productCandidates[0].review_status === "VERIFIED" &&
                      productCandidates[0].master_match_count === 1 &&
                      productCandidates[0].master_mapping_status ===
                        "CANDIDATE_ONLY"
                  )
                  .map(([, productCandidates]) => productCandidates[0]);
                const parameterIds = [
                  ...new Set(
                    uniqueVerifiedCandidates.map(
                      (candidate) => candidate.parameter_id
                    )
                  ),
                ];
                const { data: parameterRows, error: parameterError } =
                  parameterIds.length > 0
                    ? await db
                        .from("wms_vendor_product_parameters")
                        .select("id,vendor_id")
                        .in("id", parameterIds)
                    : { data: [], error: null };

                if (parameterError) {
                  warnings.push(
                    `Vendor ID terverifikasi gagal dibaca: ${parameterError.message}`
                  );
                } else {
                  const parameters = (parameterRows ?? []) as VendorParameter[];
                  const vendorIds = [
                    ...new Set(parameters.map((parameter) => parameter.vendor_id)),
                  ];
                  const { data: vendorRows, error: vendorError } =
                    vendorIds.length > 0
                      ? await db
                          .from("wms_vendor_master")
                          .select("id,vendor_name,is_active")
                          .in("id", vendorIds)
                      : { data: [], error: null };

                  if (vendorError) {
                    warnings.push(
                      `Master vendor gagal diverifikasi: ${vendorError.message}`
                    );
                  } else {
                    const parameterById = new Map(
                      parameters.map((parameter) => [
                        parameter.id,
                        parameter,
                      ])
                    );
                    const vendorById = new Map(
                      ((vendorRows ?? []) as Vendor[]).map((vendor) => [
                        vendor.id,
                        vendor,
                      ])
                    );
                    const mapped: Record<string, VerifiedVendor> = {};
                    for (const product of productRows) {
                      const candidate = uniqueVerifiedCandidates.find(
                        (item) => item.candidate_master_id === product.id
                      );
                      if (!candidate) continue;
                      const parameter = parameterById.get(
                        candidate.parameter_id
                      );
                      const vendor = parameter
                        ? vendorById.get(parameter.vendor_id)
                        : undefined;
                      const candidateCode = candidate.product_code
                        ?.trim()
                        .toUpperCase();
                      const masterCode = product.product_code
                        ?.trim()
                        .toUpperCase();
                      if (
                        !parameter ||
                        !vendor?.is_active ||
                        !vendor.vendor_name ||
                        !candidateCode ||
                        candidateCode !== masterCode
                      ) {
                        continue;
                      }
                      mapped[product.id] = {
                        vendorId: vendor.id,
                        vendorName: vendor.vendor_name,
                        leadTimeDays:
                          candidate.lead_time_days != null &&
                          Number.isFinite(Number(candidate.lead_time_days)) &&
                          Number(candidate.lead_time_days) > 0
                            ? Number(candidate.lead_time_days)
                            : null,
                      };
                    }
                    if (active) {
                      setVerifiedVendors(mapped);
                      const variantsById = new Map(
                        variants.map((variant) => [
                          variant.id,
                          variant.product_id,
                        ])
                      );
                      const productsById = new Map(
                        productRows.map((product) => [product.id, product])
                      );
                      for (const line of proposedLines) {
                        const productId = variantsById.get(line.variant_id);
                        const product = productId
                          ? productsById.get(productId)
                          : undefined;
                        const vendor = productId ? mapped[productId] : undefined;
                        const snapshotCode = line.product_code
                          ?.trim()
                          .toUpperCase();
                        const masterCode = product?.product_code
                          ?.trim()
                          .toUpperCase();
                        const snapshotVendor = line.vendor_name_snapshot
                          ?.trim()
                          .toLocaleLowerCase("id-ID");
                        if (
                          !vendor ||
                          !snapshotCode ||
                          snapshotCode !== masterCode ||
                          (snapshotVendor &&
                            snapshotVendor !==
                              vendor.vendorName
                                .trim()
                                .toLocaleLowerCase("id-ID"))
                        ) {
                          warnings.push(
                            `Vendor perlu verifikasi untuk SKU ${line.sku_snapshot ?? line.variant_id}.`
                          );
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        if (active) {
          const productByVariant = new Map(
            variants.map((variant) => [variant.id, variant.product_id])
          );
          const productById = new Map(
            productRows.map((product) => [product.id, product])
          );
          for (const line of proposedLines) {
            const productId = productByVariant.get(line.variant_id);
            const product = productId ? productById.get(productId) : undefined;
            if (
              !product ||
              !line.product_code ||
              product.product_code?.trim().toUpperCase() !==
                line.product_code.trim().toUpperCase()
            ) {
              warnings.push(
                `Kode produk Draft tidak dapat dicocokkan dengan Master untuk SKU ${line.sku_snapshot ?? line.variant_id}.`
              );
            }
          }

          if (warnings.length > 0) {
            setDataWarnings((previous) => [...previous, ...warnings]);
          }
        }

        const { data: readinessData, error: readinessError } = await db.rpc(
          "wms_production_readiness_v1",
          { p_batch_id: selectedBatchId }
        );
        if (readinessError) {
          if (active) {
            setSalesWarning(
              `Kesegaran data penjualan tidak dapat diverifikasi: ${readinessError.message}`
            );
          }
        } else {
          const result = readinessData as Readiness | null;
          if (
            !result ||
            result.batch_id !== selectedBatchId ||
            result.mode !== "SIMULATION_DATA" ||
            result.approval_enabled !== false ||
            result.po_generation_enabled !== false ||
            typeof result.sales?.fresh !== "boolean"
          ) {
            if (active) {
              setSalesWarning(
                "Hasil pemeriksaan data penjualan tidak lengkap atau tidak cocok dengan Draft."
              );
            }
          } else if (active) {
            setReadiness(result);
            if (!result.sales.fresh) {
              setSalesWarning(
                `Data penjualan kedaluwarsa atau belum lengkap (usia ${
                  result.sales.age_days ?? "tidak diketahui"
                } hari).`
              );
            }
          }
        }
        if (active) setPreviewLoaded(true);
      } catch (error) {
        if (active) {
          setPreviewLoaded(false);
          setPageError(getErrorMessage(error));
        }
      } finally {
        if (active) setLoadingPreview(false);
      }
    }

    void loadPreview();
    return () => {
      active = false;
    };
  }, [db, ready, selectedBatchId]);

  const previewGroups = useMemo(() => {
    const groups = new Map<string, PreviewGroup>();
    for (const line of lines) {
      if (line.decision !== "PROPOSE") continue;
      const productId = productIdByVariant[line.variant_id];
      const product = productId ? products[productId] : undefined;
      const candidateVendor = productId
        ? verifiedVendors[productId]
        : undefined;
      const snapshotCode = line.product_code?.trim().toUpperCase();
      const masterCode = product?.product_code?.trim().toUpperCase();
      const snapshotVendor = line.vendor_name_snapshot
        ?.trim()
        .toLocaleLowerCase("id-ID");
      const vendor =
        candidateVendor &&
        snapshotCode &&
        snapshotCode === masterCode &&
        (!snapshotVendor ||
          snapshotVendor ===
            candidateVendor.vendorName.trim().toLocaleLowerCase("id-ID"))
          ? candidateVendor
          : undefined;
      const key = vendor ? `vendor:${vendor.vendorId}` : "unverified";
      const group = groups.get(key) ?? {
        id: key,
        name: vendor?.vendorName ?? "Vendor perlu verifikasi",
        vendor: vendor ?? null,
        lines: [],
      };
      group.lines.push(line);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [lines, productIdByVariant, products, verifiedVendors]);

  const proposedLines = lines.filter((line) => line.decision === "PROPOSE");
  const hasInvalidQty = proposedLines.some((line) => {
    const qty = Number(line.proposed_qty);
    return !Number.isSafeInteger(qty) || qty <= 0;
  });
  const proposedQty = proposedLines.reduce((sum, line) => {
    const qty = Number(line.proposed_qty);
    return sum + (Number.isSafeInteger(qty) && qty > 0 ? qty : 0);
  }, 0);
  const hppEvaluations = proposedLines.map((line) => ({
    line,
    evaluation: evaluateHpp(line, hppByVariant),
  }));
  const hppMasterAvailableCount = hppEvaluations.filter(
    ({ evaluation }) => evaluation.masterAvailable
  ).length;
  const hppMasterProblematicCount = hppEvaluations.filter(
    ({ evaluation }) => evaluation.masterProblematic
  ).length;
  const vendorPriceUnverifiedCount = proposedLines.length;
  const hppSubtotalMissingCount = hppEvaluations.filter(
    ({ evaluation }) => evaluation.subtotal == null
  ).length;
  const hppEstimateComplete =
    !hasInvalidQty &&
    hppEvaluations.length > 0 &&
    hppEvaluations.every(({ evaluation }) => evaluation.subtotal != null);
  const totalHppEstimate = hppEstimateComplete
    ? hppEvaluations.reduce(
        (sum, { evaluation }) => sum + (evaluation.subtotal ?? 0),
        0
      )
    : null;
  const previewGroupsWithHpp = previewGroups.map((group) => {
    const evaluations = group.lines.map((line) => ({
      line,
      evaluation: evaluateHpp(line, hppByVariant),
    }));
    const qtyInvalid = group.lines.some((line) => {
      const qty = Number(line.proposed_qty);
      return !Number.isSafeInteger(qty) || qty <= 0;
    });
    const estimateComplete =
      !qtyInvalid &&
      evaluations.length > 0 &&
      evaluations.every(({ evaluation }) => evaluation.subtotal != null);
    return {
      group,
      evaluations,
      qty: group.lines.reduce((sum, line) => {
        const qty = Number(line.proposed_qty);
        return sum + (Number.isSafeInteger(qty) && qty > 0 ? qty : 0);
      }, 0),
      qtyInvalid,
      hppMasterAvailableCount: evaluations.filter(
        ({ evaluation }) => evaluation.masterAvailable
      ).length,
      hppMasterProblematicCount: evaluations.filter(
        ({ evaluation }) => evaluation.masterProblematic
      ).length,
      estimateComplete,
      totalHpp: estimateComplete
        ? evaluations.reduce(
            (sum, { evaluation }) => sum + (evaluation.subtotal ?? 0),
            0
          )
        : null,
    };
  });
  const notProposedCount = lines.length - proposedLines.length;
  const approvalStatus = approvalUnavailable
    ? "Tidak dapat diverifikasi"
    : approval?.status === "SUBMITTED"
      ? "Menunggu persetujuan (Simulasi)"
      : approval?.status === "APPROVED"
        ? "Disetujui (Simulasi) — bukan operasional"
        : approval?.status === "REJECTED"
          ? "DITOLAK (Simulasi)"
          : approval?.status ?? "Belum ada pengajuan";
  const rejected = approval?.status === "REJECTED";
  const approved = approval?.status === "APPROVED";

  return (
    <main className="min-w-0 max-w-full overflow-x-hidden p-4 md:p-6 lg:p-8">
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Hi.PRIMA WMS / Production Planning
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              Preview Production Order — SIMULASI
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Pemeriksaan read-only berdasarkan Draft Review tersimpan.
            </p>
          </div>
          <Link
            href="/production-planning/v4/review/"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
          >
            Kembali ke Review & Approval
          </Link>
        </header>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">
            SIMULATION ONLY — TIDAK MEMBUAT PO, MENGUBAH STOK, ATAU MENGUBAH
            STATUS DRAFT.
          </p>
          <p className="mt-1">
            Approval Simulasi bukan persetujuan produksi operasional.
          </p>
        </div>

        {pageError && (
          <div
            role="alert"
            className="break-words rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {pageError}
          </div>
        )}

        <section className="flex min-w-0 flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block font-semibold">Draft tersimpan</span>
            <select
              value={selectedBatchId}
              onChange={(event) => {
                const nextBatchId = event.target.value;
                setSelectedBatchId(nextBatchId);
                if (!nextBatchId) {
                  setSelectedBatch(null);
                  setLines([]);
                  setApproval(null);
                  setRequesterName("");
                  setVerifiedVendors({});
                  setProducts({});
                  setProductIdByVariant({});
                  setHppByVariant({});
                  setReadiness(null);
                }
              }}
              disabled={loadingBatches || batches.length === 0}
              className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="">
                {loadingBatches ? "Memuat Draft..." : "Pilih Draft"}
              </option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {formatDate(batch.created_at)} — {batch.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadBatches()}
            disabled={loadingBatches || loadingPreview}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Refresh Draft
          </button>
        </section>

        {loadingPreview && (
          <p role="status" className="text-sm text-slate-600">
            Memuat baris Draft dan memverifikasi data...
          </p>
        )}

        {selectedBatch && previewLoaded && !loadingPreview && (
          <>
            <section className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Referensi Draft</p>
                <p className="break-all font-semibold">
                  {selectedBatch.id.slice(0, 8)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  Status Approval Simulasi
                </p>
                <p
                  className={`font-semibold ${
                    rejected
                      ? "text-rose-700"
                      : approved
                        ? "text-emerald-700"
                        : "text-slate-900"
                  }`}
                >
                  {rejected
                    ? "DITOLAK (Simulasi)"
                    : approved
                      ? "Disetujui (Simulasi) — bukan operasional"
                      : approvalStatus}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Nama Pengaju</p>
                <p className="break-words">
                  {approval
                    ? requesterName || "Nama pengguna belum dilengkapi"
                    : "Belum diajukan"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Tanggal pengajuan</p>
                <p>{formatDate(approval?.requested_at)}</p>
              </div>
            </section>

            {approvalError && (
              <p
                role="alert"
                className="break-words rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              >
                {approvalError}
              </p>
            )}

            {rejected && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900">
                DITOLAK — pengajuan ini ditolak dalam mode simulasi. Status
                Draft operasional tidak diubah.
              </div>
            )}
            {approved && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                Disetujui dalam mode SIMULASI saja. Ini bukan approval produksi
                operasional dan tidak mengizinkan pembuatan PO.
              </div>
            )}

            <section className="grid min-w-0 grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 xl:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">SKU di Draft</p>
                <p className="text-lg font-bold">{lines.length}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">SKU usulan PO</p>
                <p className="text-lg font-bold">{proposedLines.length}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Qty usulan</p>
                <p className="text-lg font-bold">
                  {hasInvalidQty
                    ? "Tidak lengkap"
                    : `${formatNumber(proposedQty)} pcs`}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">HPP Master tersedia</p>
                <p className="text-lg font-bold">
                  {hppMasterAvailableCount}/{proposedLines.length} SKU
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">HPP Master bermasalah</p>
                <p className="text-lg font-bold">{hppMasterProblematicCount} SKU</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  Harga vendor belum terverifikasi
                </p>
                <p className="text-lg font-bold">
                  {vendorPriceUnverifiedCount} SKU
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  {hppEstimateComplete
                    ? "Estimasi HPP Referensi"
                    : "Estimasi biaya produksi"}
                </p>
                <p className="break-words font-semibold">
                  {hppEstimateComplete
                    ? formatCurrency(totalHppEstimate)
                    : proposedLines.length === 0
                      ? "Tidak ada SKU usulan"
                      : "Estimasi belum lengkap"}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {hppEstimateComplete
                    ? "Menggunakan HPP Master; belum terverifikasi sebagai harga vendor."
                    : proposedLines.length === 0
                      ? "Tidak ada SKU usulan untuk dihitung."
                      : `${hppSubtotalMissingCount} SKU belum dapat dihitung karena HPP atau Qty tidak valid.`}
                </p>
              </div>
            </section>

            {(salesWarning || dataWarnings.length > 0) && (
              <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <h2 className="font-bold">Peringatan data</h2>
                {salesWarning && <p>{salesWarning}</p>}
                {dataWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </section>
            )}

            {readiness && (
              <p className="text-xs text-slate-500">
                Kesegaran penjualan diperiksa saat ini pada{" "}
                {readiness.as_of_date}; ini bukan snapshot pada saat Draft
                disimpan. Penjualan terakhir:{" "}
                {readiness.sales.last_sale_date ?? "belum tersedia"}.
              </p>
            )}

            <div className="space-y-4">
              {previewGroupsWithHpp.map((groupWithHpp) => {
                const {
                  group,
                  evaluations,
                  qty,
                  qtyInvalid,
                  hppMasterAvailableCount,
                  hppMasterProblematicCount,
                  estimateComplete,
                  totalHpp,
                } = groupWithHpp;
                return (
                <section
                  key={group.id}
                  className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                  <header className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-slate-200 p-4">
                    <div className="min-w-0">
                      <h2 className="break-words font-bold">
                        Vendor: {group.name}
                      </h2>
                      {group.vendor ? (
                        <p className="mt-1 text-sm text-slate-600">
                          Terverifikasi melalui mapping produk dan Vendor
                          Master.
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-amber-800">
                          Vendor perlu verifikasi; item belum dapat
                          dikelompokkan ke Vendor Master.
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 text-right text-xs text-slate-600">
                      <p className="font-semibold">
                        {group.lines.length} SKU ·{" "}
                        {qtyInvalid
                          ? "Qty tidak lengkap"
                          : `${formatNumber(qty)} pcs`}
                      </p>
                      <p>
                        HPP Master tersedia: {hppMasterAvailableCount}/
                        {group.lines.length} SKU
                      </p>
                      <p>
                        HPP Master bermasalah: {hppMasterProblematicCount} SKU
                      </p>
                      <p>
                        Harga vendor belum terverifikasi: {group.lines.length}{" "}
                        SKU
                      </p>
                      <p className="font-semibold">
                        {estimateComplete
                          ? `Estimasi HPP Referensi (kelompok vendor): ${formatCurrency(totalHpp)}`
                          : "Estimasi HPP belum lengkap"}
                      </p>
                    </div>
                  </header>

                  <div className="w-full min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[1280px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs">
                        <tr>
                          {[
                            "SKU",
                            "Nama Produk",
                            "Qty Usulan",
                            "HPP Referensi / Unit",
                            "Sumber HPP",
                            "Validasi HPP",
                            "Subtotal Estimasi HPP Referensi",
                            "MOQ Draft & Scope",
                            "Lead Time",
                            "Estimasi ETA",
                          ].map((heading) => (
                            <th
                              key={heading}
                              className="border-b border-slate-200 px-3 py-2"
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {evaluations.map(({ line, evaluation }) => {
                          const eta =
                            group.vendor?.leadTimeDays != null
                              ? addDays(wibDate(), group.vendor.leadTimeDays)
                              : null;
                          const qty = Number(line.proposed_qty);
                          const productId =
                            productIdByVariant[line.variant_id];
                          const product = productId
                            ? products[productId]
                            : undefined;
                          const hppEvaluation = evaluation;
                          const hppReference = hppEvaluation.reference;

                          return (
                            <tr
                              key={`${line.batch_id}-${line.variant_id}`}
                              className="border-b border-slate-100 align-top"
                            >
                              <td className="break-words px-3 py-2">
                                {line.sku_snapshot || "SKU tidak tersedia"}
                              </td>
                              <td className="break-words px-3 py-2">
                                {product?.name || "Nama produk tidak tersedia"}
                              </td>
                              <td className="px-3 py-2">
                                {Number.isFinite(qty) && qty > 0
                                  ? `${formatNumber(qty)} pcs`
                                  : "Qty tidak valid"}
                              </td>
                              <td className="px-3 py-2">
                                {formatCurrency(hppReference?.hpp)}
                                {hppReference?.costPrice != null && (
                                  <span className="block text-xs text-slate-500">
                                    cost_price:{" "}
                                    {formatCurrency(hppReference.costPrice)}
                                  </span>
                                )}
                                {hppReference?.historyEntryFound && (
                                  <span className="block text-xs text-slate-500">
                                    Riwayat tercatat (
                                    {formatDate(hppReference.historyAt)}):{" "}
                                    {formatCurrency(
                                      hppReference.latestHistoryHpp
                                    )}
                                  </span>
                                )}
                                {hppReference &&
                                  !hppReference.historyEntryFound &&
                                  !hppReference.historyReadError && (
                                    <span className="block text-xs text-amber-700">
                                      Riwayat HPP belum tersedia
                                    </span>
                                  )}
                              </td>
                              <td className="px-3 py-2">
                                {hppEvaluation.source}
                              </td>
                              <td className="max-w-[240px] whitespace-normal px-3 py-2">
                                <span className="block">
                                  HPP Master:{" "}
                                  {hppEvaluation.masterAvailable
                                    ? "Tersedia"
                                    : "Bermasalah"}
                                </span>
                                <span className="block">
                                  Konsistensi: {hppEvaluation.consistencyStatus}
                                </span>
                                <span className="block text-xs text-slate-500">
                                  Harga produksi vendor: belum terverifikasi
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {hppEvaluation.subtotal == null
                                  ? "Tidak dihitung"
                                  : (
                                      <>
                                        <span className="block text-xs font-semibold">
                                          Estimasi HPP Referensi
                                        </span>
                                        {formatCurrency(hppEvaluation.subtotal)}
                                      </>
                                    )}
                              </td>
                              <td className="px-3 py-2">
                                {line.moq_quantity == null
                                  ? "MOQ belum tersedia"
                                  : `${formatNumber(Number(line.moq_quantity))} pcs`}
                                {" · "}
                                {moqScope(line.moq_type)}
                                <span className="block text-xs text-amber-800">
                                  Nilai scope mengikuti Draft; definisi dan
                                  kelulusan MOQ perlu verifikasi lanjutan.
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {group.vendor?.leadTimeDays != null
                                  ? `${formatNumber(group.vendor.leadTimeDays)} hari`
                                  : "Belum terverifikasi"}
                              </td>
                              <td className="px-3 py-2">
                                {eta ?? "Belum dapat diestimasi"}
                                {eta && (
                                  <span className="block text-xs text-slate-500">
                                    Berdasarkan lead time saat ini
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              Qty, keputusan, MOQ, dan scope berasal dari baris Draft
              tersimpan. Nama produk, mapping vendor, dan lead time dibaca dari
              Master saat preview; nilai tersebut bukan snapshot saat Draft
              dibuat.
            </p>

            {notProposedCount > 0 && (
              <p className="text-sm text-slate-600">
                {notProposedCount} baris Draft dengan keputusan HOLD/EXCLUDE
                tidak termasuk dalam usulan PO.
              </p>
            )}

            <section className="rounded-xl border border-slate-300 bg-slate-100 p-4">
              <button
                type="button"
                disabled
                title="Pembuatan PO hanya dapat diaktifkan melalui RPC server-side atomik setelah desain idempotensi dan validasi operasional disetujui."
                className="cursor-not-allowed rounded-lg bg-slate-400 px-4 py-2 text-sm font-bold text-white"
              >
                Generate PO — Belum Aktif
              </button>
              <p className="mt-2 text-sm text-slate-700">
                Dinonaktifkan: V4.3A hanya preview. Belum tersedia RPC aman
                untuk mengonversi Draft Review menjadi PO secara atomik dan
                idempoten. Tidak ada RPC pembuatan PO yang dipanggil halaman ini.
              </p>
              <p className="mt-2 text-xs text-slate-600">
                Pencegahan PO ganda harus ditegakkan di database dengan
                penguncian batch dan unique source_batch_id/idempotency key,
                pemeriksaan status serta otorisasi server, dan satu transaksi
                pembuatan header beserta seluruh baris. Pemeriksaan browser
                saja tidak memadai.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
