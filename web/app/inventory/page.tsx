"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";


type InventoryRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  barcode: string | null;

  normal_qty: number | string;
  defect_qty: number | string;
  reject_qty: number | string;
  total_qty: number | string;

  normal_locations: string | null;
  defect_locations: string | null;
  reject_locations: string | null;

  total_count: number | string;
};


type PriceRow = {
  id: string;
  hpp: number | string | null;
  selling_price: number | string | null;
};


type ValuationSummary = {
  normal_qty: number | string;
  defect_qty: number | string;
  reject_qty: number | string;
  total_qty: number | string;

  normal_inventory_value_hpp: number | string;
  defect_inventory_value_hpp: number | string;
  reject_inventory_value_hpp: number | string;
  total_inventory_value_hpp: number | string;

  potential_sales_value: number | string;
  potential_gross_profit: number | string;
  margin_pct: number | string | null;
};


type InventoryDisplayRow = InventoryRow & {
  hpp: number;
  selling_price: number;

  normal_inventory_value_hpp: number;
  defect_inventory_value_hpp: number;
  reject_inventory_value_hpp: number;
  total_inventory_value_hpp: number;

  potential_sales_value: number;
  potential_gross_profit: number;

  margin_pct: number | null;
};


export default function InventoryPage() {

  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );


  const pageSize = 50;


  // ============================================================
  // STATE
  // ============================================================

  const [inventory, setInventory] =
    useState<InventoryDisplayRow[]>(
      []
    );


  const [summary, setSummary] =
    useState<ValuationSummary | null>(
      null
    );


  const [searchInput, setSearchInput] =
    useState("");


  const [search, setSearch] =
    useState("");


  const [currentPage, setCurrentPage] =
    useState(1);


  const [totalCount, setTotalCount] =
    useState(0);


  const [loading, setLoading] =
    useState(true);


  const [errorMessage, setErrorMessage] =
    useState("");


  const [urlReady, setUrlReady] =
    useState(false);


  // ============================================================
  // READ URL
  // ============================================================

  useEffect(() => {

    const params =
      new URLSearchParams(
        window.location.search
      );


    const urlSearch =
      params.get("q")?.trim() ??
      "";


    const urlPage =
      Math.max(
        Number(
          params.get("page") ??
            "1"
        ) || 1,
        1
      );


    setSearchInput(
      urlSearch
    );


    setSearch(
      urlSearch
    );


    setCurrentPage(
      urlPage
    );


    setUrlReady(
      true
    );

  }, []);


  // ============================================================
  // LOAD INVENTORY
  // ============================================================

  const loadInventory =
    useCallback(
      async () => {

        if (!urlReady) {
          return;
        }


        setLoading(
          true
        );


        setErrorMessage(
          ""
        );


        // ------------------------------------------------------
        // AUTH CHECK
        // ------------------------------------------------------

        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();


        if (!user) {

          router.replace(
            "/login"
          );

          return;
        }


        // ------------------------------------------------------
        // INVENTORY LIST + SUMMARY
        // ------------------------------------------------------

        const offset =
          (
            currentPage - 1
          ) *
          pageSize;


        const [
          inventoryResult,
          summaryResult,
        ] =
          await Promise.all([

            supabase.rpc(
              "get_inventory_list",
              {
                p_search:
                  search ||
                  null,

                p_limit:
                  pageSize,

                p_offset:
                  offset,
              }
            ),


            supabase.rpc(
              "get_inventory_valuation_summary"
            ),

          ]);


        // ------------------------------------------------------
        // INVENTORY ERROR
        // ------------------------------------------------------

        if (
          inventoryResult.error
        ) {

          setInventory(
            []
          );


          setSummary(
            null
          );


          setErrorMessage(
            `Inventory error: ${inventoryResult.error.message}`
          );


          setLoading(
            false
          );


          return;
        }


        // ------------------------------------------------------
        // SUMMARY ERROR
        // ------------------------------------------------------

        if (
          summaryResult.error
        ) {

          setInventory(
            []
          );


          setSummary(
            null
          );


          setErrorMessage(
            `Valuation error: ${summaryResult.error.message}`
          );


          setLoading(
            false
          );


          return;
        }


        const inventoryRows =
          (
            inventoryResult.data ??
            []
          ) as InventoryRow[];


        const summaryRows =
          (
            summaryResult.data ??
            []
          ) as ValuationSummary[];


        const summaryRow =
          summaryRows[0] ??
          null;


        setSummary(
          summaryRow
        );


        const count =
          Number(
            inventoryRows[0]
              ?.total_count ??
              0
          );


        setTotalCount(
          count
        );


        // ------------------------------------------------------
        // GET HPP + SELLING PRICE
        // FOR CURRENT PAGE
        // ------------------------------------------------------

        const variantIds =
          inventoryRows
            .map(
              (row) =>
                row.variant_id
            )
            .filter(
              Boolean
            );


        let priceRows:
          PriceRow[] = [];


        if (
          variantIds.length >
          0
        ) {

          const {
            data: priceData,
            error: priceError,
          } =
            await supabase
              .from(
                "product_variants"
              )
              .select(
                "id, hpp, selling_price"
              )
              .in(
                "id",
                variantIds
              );


          if (priceError) {

            setInventory(
              []
            );


            setErrorMessage(
              `Price error: ${priceError.message}`
            );


            setLoading(
              false
            );


            return;
          }


          priceRows =
            (
              priceData ??
              []
            ) as PriceRow[];

        }


        // ------------------------------------------------------
        // PRICE MAP
        // ------------------------------------------------------

        const priceMap =
          new Map<
            string,
            PriceRow
          >();


        for (
          const row of priceRows
        ) {

          priceMap.set(
            row.id,
            row
          );

        }


        // ------------------------------------------------------
        // MERGE INVENTORY + PRICE
        // ------------------------------------------------------

        const merged =
          inventoryRows.map(
            (
              row
            ) => {

              const price =
                priceMap.get(
                  row.variant_id
                );


              const hpp =
                Number(
                  price?.hpp ??
                    0
                );


              const sellingPrice =
                Number(
                  price?.selling_price ??
                    0
                );


              const normalQty =
                Number(
                  row.normal_qty ??
                    0
                );


              const defectQty =
                Number(
                  row.defect_qty ??
                    0
                );


              const rejectQty =
                Number(
                  row.reject_qty ??
                    0
                );


              const totalQty =
                Number(
                  row.total_qty ??
                    0
                );


              const grossProfit =
                sellingPrice -
                hpp;


              const normalValue =
                normalQty *
                hpp;


              const defectValue =
                defectQty *
                hpp;


              const rejectValue =
                rejectQty *
                hpp;


              const totalValue =
                totalQty *
                hpp;


              const potentialSales =
                normalQty *
                sellingPrice;


              const potentialGrossProfit =
                normalQty *
                grossProfit;


              const margin =
                potentialSales >
                0
                  ? (
                      potentialGrossProfit /
                      potentialSales
                    ) *
                    100
                  : null;


              return {

                ...row,

                hpp,

                selling_price:
                  sellingPrice,

                normal_inventory_value_hpp:
                  normalValue,

                defect_inventory_value_hpp:
                  defectValue,

                reject_inventory_value_hpp:
                  rejectValue,

                total_inventory_value_hpp:
                  totalValue,

                potential_sales_value:
                  potentialSales,

                potential_gross_profit:
                  potentialGrossProfit,

                margin_pct:
                  margin,

              };

            }
          );


        setInventory(
          merged
        );


        setLoading(
          false
        );

      },
      [
        currentPage,
        pageSize,
        router,
        search,
        supabase,
        urlReady,
      ]
    );


  useEffect(
    () => {

      loadInventory();

    },
    [
      loadInventory,
    ]
  );


  // ============================================================
  // FORMATTERS
  // ============================================================

  const formatNumber = (
    value:
      | number
      | string
      | null
      | undefined
  ) =>
    Number(
      value ?? 0
    ).toLocaleString(
      "id-ID"
    );


  const formatRupiah = (
    value:
      | number
      | string
      | null
      | undefined
  ) =>
    `Rp ${Number(
      value ?? 0
    ).toLocaleString(
      "id-ID"
    )}`;


  const formatPercent = (
    value:
      | number
      | string
      | null
      | undefined
  ) => {

    if (
      value === null ||
      value === undefined
    ) {

      return "-";

    }


    return `${Number(
      value
    ).toLocaleString(
      "id-ID",
      {
        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2,
      }
    )}%`;

  };


  // ============================================================
  // SUMMARY VALUES
  // ============================================================

  const totalInventoryValue =
    Number(
      summary?.total_inventory_value_hpp ??
        0
    );


  const normalInventoryValue =
    Number(
      summary?.normal_inventory_value_hpp ??
        0
    );


  const defectInventoryValue =
    Number(
      summary?.defect_inventory_value_hpp ??
        0
    );


  const rejectInventoryValue =
    Number(
      summary?.reject_inventory_value_hpp ??
        0
    );


  const potentialSales =
    Number(
      summary?.potential_sales_value ??
        0
    );


  const potentialGrossProfit =
    Number(
      summary?.potential_gross_profit ??
        0
    );


  const margin =
    summary?.margin_pct ==
    null
      ? null
      : Number(
          summary.margin_pct
        );


  const normalQty =
    Number(
      summary?.normal_qty ??
        0
    );


  const defectQty =
    Number(
      summary?.defect_qty ??
        0
    );


  const rejectQty =
    Number(
      summary?.reject_qty ??
        0
    );


  const totalQty =
    Number(
      summary?.total_qty ??
        0
    );


  const totalPages =
    Math.max(
      Math.ceil(
        totalCount /
          pageSize
      ),
      1
    );


  // ============================================================
  // URL
  // ============================================================

  const updateUrl = (
    nextPage: number,
    nextSearch: string
  ) => {

    const params =
      new URLSearchParams();


    if (nextSearch) {

      params.set(
        "q",
        nextSearch
      );

    }


    if (
      nextPage > 1
    ) {

      params.set(
        "page",
        String(
          nextPage
        )
      );

    }


    const query =
      params.toString();


    router.push(
      query
        ? `/inventory?${query}`
        : "/inventory"
    );

  };


  // ============================================================
  // SEARCH
  // ============================================================

  function handleSearch(
    event:
      FormEvent<HTMLFormElement>
  ) {

    event.preventDefault();


    const nextSearch =
      searchInput.trim();


    setSearch(
      nextSearch
    );


    setCurrentPage(
      1
    );


    updateUrl(
      1,
      nextSearch
    );

  }


  function handleReset() {

    setSearchInput(
      ""
    );


    setSearch(
      ""
    );


    setCurrentPage(
      1
    );


    updateUrl(
      1,
      ""
    );

  }


  // ============================================================
  // PAGINATION
  // ============================================================

  function handlePageChange(
    page: number
  ) {

    if (
      page < 1 ||
      page > totalPages
    ) {

      return;

    }


    setCurrentPage(
      page
    );


    updateUrl(
      page,
      search
    );

  }


  // ============================================================
  // LOCATION RENDER
  // ============================================================

  const renderLocation = (
    title: string,
    value: string | null,
    type:
      | "normal"
      | "defect"
      | "reject"
  ) => {

    const titleClass =
      type === "normal"
        ? "text-slate-700"
        : type === "defect"
        ? "text-amber-700"
        : "text-red-700";


    const boxClass =
      type === "normal"
        ? "bg-slate-50"
        : type === "defect"
        ? "bg-amber-50 text-amber-800"
        : "bg-red-50 text-red-800";


    return (

      <div className="mb-3 last:mb-0">

        <div
          className={`mb-1 text-xs font-semibold ${titleClass}`}
        >
          {title}
        </div>


        {value ? (

          <div
            className={`whitespace-pre-line rounded-md px-2 py-1 text-xs ${boxClass}`}
          >
            {value}
          </div>

        ) : (

          <div className="text-xs text-slate-400">
            -
          </div>

        )}

      </div>

    );

  };


  // ============================================================
  // UI
  // ============================================================

  return (

    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">

      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />


        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">

          <div className="mx-auto w-full min-w-0 max-w-[1600px]">


            {/* ================================================= */}
            {/* HEADER */}
            {/* ================================================= */}

            <header className="mb-8">

              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>


              <h1 className="mt-1 text-3xl font-bold">
                Inventory
              </h1>


              <p className="mt-2 text-sm text-slate-500">
                Monitoring stok SKU berdasarkan area dan lokasi gudang
              </p>

            </header>


            {/* ================================================= */}
            {/* ERROR */}
            {/* ================================================= */}

            {errorMessage && (

              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">

                {errorMessage}

              </div>

            )}


            {/* ================================================= */}
            {/* STOCK SUMMARY */}
            {/* ================================================= */}

            <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">


              {/* TOTAL STOCK */}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <p className="text-sm font-medium text-slate-500">
                  Total Stock
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(
                    totalQty
                  )}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Normal + Defect + Reject
                </p>

              </div>


              {/* NORMAL */}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <p className="text-sm font-medium text-slate-500">
                  Normal
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(
                    normalQty
                  )}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Siap jual
                </p>

              </div>


              {/* DEFECT */}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <p className="text-sm font-medium text-slate-500">
                  Defect
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(
                    defectQty
                  )}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Perlu pengecekan
                </p>

              </div>


              {/* REJECT */}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <p className="text-sm font-medium text-slate-500">
                  Reject
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(
                    rejectQty
                  )}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Stok reject
                </p>

              </div>

            </section>


            {/* ================================================= */}
            {/* INVENTORY VALUATION */}
            {/* ================================================= */}

            <section className="mb-6">


              <div className="mb-4">

                <h2 className="text-lg font-semibold">
                  Inventory Valuation
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Nilai stok berdasarkan HPP
                </p>

              </div>


              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">


                {/* TOTAL */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Total Inventory Value
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(
                      totalInventoryValue
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Semua status stok
                  </p>

                </div>


                {/* NORMAL */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Nilai HPP Normal
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(
                      normalInventoryValue
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Normal stock
                  </p>

                </div>


                {/* DEFECT */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Nilai HPP Defect
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(
                      defectInventoryValue
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Tetap dihitung sebagai nilai stok
                  </p>

                </div>


                {/* REJECT */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Nilai HPP Reject
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(
                      rejectInventoryValue
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Tetap dihitung sebagai nilai stok
                  </p>

                </div>

              </div>

            </section>


            {/* ================================================= */}
            {/* SALES + PROFIT */}
            {/* ================================================= */}

            <section className="mb-6">


              <div className="mb-4">

                <h2 className="text-lg font-semibold">
                  Potential Sales & Profit
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Hanya berdasarkan stok NORMAL
                </p>

              </div>


              <div className="grid gap-4 sm:grid-cols-3">


                {/* SALES */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Potential Sales Value
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(
                      potentialSales
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Normal × Harga Jual
                  </p>

                </div>


                {/* GP */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Potential Gross Profit
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(
                      potentialGrossProfit
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Normal × (Harga Jual − HPP)
                  </p>

                </div>


                {/* MARGIN */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                  <p className="text-sm font-medium text-slate-500">
                    Margin
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatPercent(
                      margin
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Gross Profit ÷ Potential Sales
                  </p>

                </div>

              </div>

            </section>


            {/* ================================================= */}
            {/* SEARCH */}
            {/* ================================================= */}

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form
                onSubmit={
                  handleSearch
                }
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >

                <input
                  name="q"
                  value={
                    searchInput
                  }
                  onChange={(
                    event
                  ) =>
                    setSearchInput(
                      event.target.value
                    )
                  }
                  placeholder="Cari SKU, kode produk, nama produk, atau warna..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />


                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Search
                </button>


                {search && (

                  <button
                    type="button"
                    onClick={
                      handleReset
                    }
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-sm hover:bg-slate-50"
                  >
                    Reset
                  </button>

                )}

              </form>

            </section>


            {/* ================================================= */}
            {/* INVENTORY LIST */}
            {/* ================================================= */}

            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">


              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">

                <div>

                  <h2 className="text-lg font-semibold">
                    Inventory List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {formatNumber(
                      totalCount
                    )}{" "}
                    SKU ditemukan
                  </p>

                </div>


                <div className="shrink-0 text-sm text-slate-500">
                  Page{" "}
                  {
                    currentPage
                  }{" "}
                  of{" "}
                  {
                    totalPages
                  }
                </div>

              </div>


              {/* ================================================= */}
              {/* TABLE ONLY SCROLLS HORIZONTALLY */}
              {/* ================================================= */}

              <div className="w-full max-w-full overflow-x-auto">

                <table className="w-full min-w-[1900px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">

                    <tr>

                      <th className="px-5 py-4">
                        SKU
                      </th>

                      <th className="px-5 py-4">
                        Product
                      </th>

                      <th className="px-5 py-4">
                        Variant
                      </th>

                      <th className="px-5 py-4 text-right">
                        HPP
                      </th>

                      <th className="px-5 py-4 text-right">
                        Normal
                      </th>

                      <th className="px-5 py-4 text-right">
                        Defect
                      </th>

                      <th className="px-5 py-4 text-right">
                        Reject
                      </th>

                      <th className="px-5 py-4 text-right">
                        Total
                      </th>

                      <th className="px-5 py-4 text-right">
                        Nilai HPP Normal
                      </th>

                      <th className="px-5 py-4 text-right">
                        Nilai HPP Defect
                      </th>

                      <th className="px-5 py-4 text-right">
                        Nilai HPP Reject
                      </th>

                      <th className="px-5 py-4 text-right">
                        Total Nilai HPP
                      </th>

                      <th className="px-5 py-4 text-right">
                        Potential Sales
                      </th>

                      <th className="px-5 py-4 text-right">
                        Potential GP
                      </th>

                      <th className="px-5 py-4 text-right">
                        Margin
                      </th>

                      <th className="min-w-[220px] px-5 py-4">
                        Location
                      </th>

                    </tr>

                  </thead>


                  <tbody className="divide-y divide-slate-100">

                    {inventory.map(
                      (row) => (

                        <tr
                          key={
                            row.variant_id
                          }
                          className="align-top hover:bg-slate-50"
                        >


                          {/* SKU */}

                          <td className="px-5 py-5">

                            <div className="font-semibold">
                              {
                                row.sku
                              }
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {
                                row.product_code
                              }
                            </div>

                          </td>


                          {/* PRODUCT */}

                          <td className="px-5 py-5">

                            <div>
                              {
                                row.product_name
                              }
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {
                                row.brand ??
                                "-"
                              }
                            </div>

                          </td>


                          {/* VARIANT */}

                          <td className="px-5 py-5">

                            <div>
                              {
                                row.color ??
                                "-"
                              }
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              Size:{" "}
                              {
                                row.size ??
                                "-"
                              }
                            </div>

                          </td>


                          {/* HPP */}

                          <td className="whitespace-nowrap px-5 py-5 text-right font-medium">

                            {
                              formatRupiah(
                                row.hpp
                              )
                            }

                          </td>


                          {/* NORMAL */}

                          <td className="px-5 py-5 text-right">

                            {
                              formatNumber(
                                row.normal_qty
                              )
                            }

                          </td>


                          {/* DEFECT */}

                          <td className="px-5 py-5 text-right">

                            {
                              formatNumber(
                                row.defect_qty
                              )
                            }

                          </td>


                          {/* REJECT */}

                          <td className="px-5 py-5 text-right">

                            {
                              formatNumber(
                                row.reject_qty
                              )
                            }

                          </td>


                          {/* TOTAL */}

                          <td className="px-5 py-5 text-right">

                            <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1 font-bold">

                              {
                                formatNumber(
                                  row.total_qty
                                )
                              }

                            </span>

                          </td>


                          {/* NORMAL VALUE */}

                          <td className="whitespace-nowrap px-5 py-5 text-right">

                            {
                              formatRupiah(
                                row.normal_inventory_value_hpp
                              )
                            }

                          </td>


                          {/* DEFECT VALUE */}

                          <td className="whitespace-nowrap px-5 py-5 text-right">

                            {
                              formatRupiah(
                                row.defect_inventory_value_hpp
                              )
                            }

                          </td>


                          {/* REJECT VALUE */}

                          <td className="whitespace-nowrap px-5 py-5 text-right">

                            {
                              formatRupiah(
                                row.reject_inventory_value_hpp
                              )
                            }

                          </td>


                          {/* TOTAL VALUE */}

                          <td className="whitespace-nowrap px-5 py-5 text-right font-bold">

                            {
                              formatRupiah(
                                row.total_inventory_value_hpp
                              )
                            }

                          </td>


                          {/* POTENTIAL SALES */}

                          <td className="whitespace-nowrap px-5 py-5 text-right">

                            {
                              formatRupiah(
                                row.potential_sales_value
                              )
                            }

                          </td>


                          {/* POTENTIAL GP */}

                          <td className="whitespace-nowrap px-5 py-5 text-right font-semibold">

                            {
                              formatRupiah(
                                row.potential_gross_profit
                              )
                            }

                          </td>


                          {/* MARGIN */}

                          <td className="whitespace-nowrap px-5 py-5 text-right font-semibold">

                            {
                              formatPercent(
                                row.margin_pct
                              )
                            }

                          </td>


                          {/* LOCATION */}

                          <td className="px-5 py-5">

                            {
                              renderLocation(
                                "NORMAL",
                                row.normal_locations,
                                "normal"
                              )
                            }


                            {
                              renderLocation(
                                "DEFECT",
                                row.defect_locations,
                                "defect"
                              )
                            }


                            {
                              row.reject_qty &&
                              Number(
                                row.reject_qty
                              ) >
                                0
                                ? renderLocation(
                                    "REJECT",
                                    row.reject_locations,
                                    "reject"
                                  )
                                : null
                            }

                          </td>


                        </tr>

                      )
                    )}


                    {!loading &&
                      inventory.length ===
                        0 && (

                        <tr>

                          <td
                            colSpan={
                              16
                            }
                            className="px-5 py-12 text-center text-slate-500"
                          >
                            Tidak ada inventory ditemukan.
                          </td>

                        </tr>

                      )}

                  </tbody>

                </table>

              </div>


              {/* ================================================= */}
              {/* PAGINATION */}
              {/* ================================================= */}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">


                <div className="text-sm text-slate-500">
                  Menampilkan maksimal{" "}
                  {
                    pageSize
                  }{" "}
                  SKU per halaman
                </div>


                <div className="flex shrink-0 gap-2">


                  <button
                    type="button"
                    disabled={
                      currentPage <=
                      1
                    }
                    onClick={() =>
                      handlePageChange(
                        currentPage -
                          1
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Previous
                  </button>


                  <button
                    type="button"
                    disabled={
                      currentPage >=
                      totalPages
                    }
                    onClick={() =>
                      handlePageChange(
                        currentPage +
                          1
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Next
                  </button>


                </div>

              </div>

            </section>


          </div>

        </main>

      </div>

    </div>

  );

}