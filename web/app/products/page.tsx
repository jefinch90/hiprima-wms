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

type ProductRow = {
  product_id: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  variant_count: number | string;
  total_qty: number | string;
  total_count: number | string;
};

type VariantStockRow = {
  variant_id: string;
  sku: string;
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
};

type ProfitabilityRow = {
  variant_id: string;
  sku: string;
  color: string | null;
  size: string | null;
  barcode: string | null;

  hpp: number | string;
  selling_price: number | string;
  gross_profit: number | string;
  margin_pct: number | string | null;

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
};

type DetailVariant = VariantStockRow & {
  hpp: number;
  selling_price: number;
  gross_profit: number;
  margin_pct: number | null;

  normal_inventory_value_hpp: number;
  defect_inventory_value_hpp: number;
  reject_inventory_value_hpp: number;
  total_inventory_value_hpp: number;

  potential_sales_value: number;
  potential_gross_profit: number;
};

export default function ProductsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [variants, setVariants] = useState<DetailVariant[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);

  const [selectedProductId, setSelectedProductId] =
    useState("");

  const [selectedProduct, setSelectedProduct] =
    useState<ProductRow | null>(null);

  const [totalCount, setTotalCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [urlReady, setUrlReady] = useState(false);


  // ============================================================
  // READ URL
  // ============================================================

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

    const urlSearch =
      params.get("q")?.trim() ?? "";

    const urlPage = Math.max(
      Number(params.get("page") ?? "1") || 1,
      1
    );

    const urlProduct =
      params.get("product") ?? "";

    setSearchInput(urlSearch);
    setSearch(urlSearch);
    setCurrentPage(urlPage);
    setSelectedProductId(urlProduct);

    setUrlReady(true);
  }, []);


  // ============================================================
  // LOAD PRODUCTS + DETAIL
  // ============================================================

  const loadProducts = useCallback(
    async () => {
      if (!urlReady) {
        return;
      }

      setLoading(true);
      setErrorMessage("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }


      // --------------------------------------------------------
      // PRODUCT LIST
      // --------------------------------------------------------

      const offset =
        (currentPage - 1) * pageSize;

      const {
        data,
        error,
      } = await supabase.rpc(
        "get_products_list",
        {
          p_search:
            search || null,
          p_limit: pageSize,
          p_offset: offset,
        }
      );

      if (error) {
        setProducts([]);
        setTotalCount(0);
        setSelectedProduct(null);
        setVariants([]);

        setErrorMessage(
          `Products error: ${error.message}`
        );

        setLoading(false);
        return;
      }

      const rows =
        (data ?? []) as ProductRow[];

      setProducts(rows);

      const count = Number(
        rows[0]?.total_count ?? 0
      );

      setTotalCount(count);


      // --------------------------------------------------------
      // NO DETAIL
      // --------------------------------------------------------

      if (!selectedProductId) {
        setSelectedProduct(null);
        setVariants([]);
        setLoading(false);
        return;
      }


      // --------------------------------------------------------
      // SELECTED PRODUCT
      // --------------------------------------------------------

      let product =
        rows.find(
          (item) =>
            item.product_id ===
            selectedProductId
        ) ?? null;


      // If product is not on current page,
      // get its basic information directly.

      if (!product) {
        const {
          data: productData,
          error: productError,
        } = await supabase
          .from("products")
          .select(
            "id, product_code, name, brand"
          )
          .eq(
            "id",
            selectedProductId
          )
          .single();

        if (
          productError ||
          !productData
        ) {
          setSelectedProduct(null);
          setVariants([]);

          setErrorMessage(
            productError
              ? `Product detail error: ${productError.message}`
              : "Produk tidak ditemukan."
          );

          setLoading(false);
          return;
        }

        product = {
          product_id:
            productData.id,
          product_code:
            productData.product_code,
          product_name:
            productData.name,
          brand:
            productData.brand,
          variant_count: 0,
          total_qty: 0,
          total_count: 0,
        };
      }

      setSelectedProduct(product);


      // --------------------------------------------------------
      // STOCK + PROFITABILITY
      // --------------------------------------------------------

      const [
        stockResult,
        profitabilityResult,
      ] = await Promise.all([
        supabase.rpc(
          "get_product_variants",
          {
            p_product_id:
              selectedProductId,
          }
        ),

        supabase.rpc(
          "get_product_profitability",
          {
            p_product_id:
              selectedProductId,
          }
        ),
      ]);


      if (stockResult.error) {
        setVariants([]);

        setErrorMessage(
          `Product variants error: ${stockResult.error.message}`
        );

        setLoading(false);
        return;
      }


      if (profitabilityResult.error) {
        setVariants([]);

        setErrorMessage(
          `Product profitability error: ${profitabilityResult.error.message}`
        );

        setLoading(false);
        return;
      }


      const stockRows =
        (stockResult.data ??
          []) as VariantStockRow[];

      const profitabilityRows =
        (profitabilityResult.data ??
          []) as ProfitabilityRow[];


      // --------------------------------------------------------
      // PROFITABILITY MAP
      // --------------------------------------------------------

      const profitabilityMap =
        new Map<
          string,
          ProfitabilityRow
        >();

      for (
        const row of profitabilityRows
      ) {
        profitabilityMap.set(
          row.variant_id,
          row
        );
      }


      // --------------------------------------------------------
      // MERGE STOCK + PROFITABILITY
      // --------------------------------------------------------

      const merged =
        stockRows.map(
          (stockRow) => {

            const profit =
              profitabilityMap.get(
                stockRow.variant_id
              );

            return {
              ...stockRow,

              hpp: Number(
                profit?.hpp ?? 0
              ),

              selling_price:
                Number(
                  profit?.selling_price ??
                    0
                ),

              gross_profit:
                Number(
                  profit?.gross_profit ??
                    0
                ),

              margin_pct:
                profit?.margin_pct ==
                null
                  ? null
                  : Number(
                      profit.margin_pct
                    ),

              normal_inventory_value_hpp:
                Number(
                  profit?.normal_inventory_value_hpp ??
                    0
                ),

              defect_inventory_value_hpp:
                Number(
                  profit?.defect_inventory_value_hpp ??
                    0
                ),

              reject_inventory_value_hpp:
                Number(
                  profit?.reject_inventory_value_hpp ??
                    0
                ),

              total_inventory_value_hpp:
                Number(
                  profit?.total_inventory_value_hpp ??
                    0
                ),

              potential_sales_value:
                Number(
                  profit?.potential_sales_value ??
                    0
                ),

              potential_gross_profit:
                Number(
                  profit?.potential_gross_profit ??
                    0
                ),
            };
          }
        );

      setVariants(merged);
      setLoading(false);
    },
    [
      currentPage,
      pageSize,
      router,
      search,
      selectedProductId,
      supabase,
      urlReady,
    ]
  );


  useEffect(() => {
    loadProducts();
  }, [loadProducts]);


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
    ).toLocaleString("id-ID");


  const formatRupiah = (
    value:
      | number
      | string
      | null
      | undefined
  ) =>
    `Rp ${Number(
      value ?? 0
    ).toLocaleString("id-ID")}`;


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
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    )}%`;
  };


  // ============================================================
  // DETAIL TOTALS
  // ============================================================

  const detailNormalQty =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.normal_qty ?? 0
        ),
      0
    );


  const detailDefectQty =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.defect_qty ?? 0
        ),
      0
    );


  const detailRejectQty =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.reject_qty ?? 0
        ),
      0
    );


  const detailTotalQty =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.total_qty ?? 0
        ),
      0
    );


  const detailNormalValueHpp =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.normal_inventory_value_hpp ??
            0
        ),
      0
    );


  const detailDefectValueHpp =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.defect_inventory_value_hpp ??
            0
        ),
      0
    );


  const detailRejectValueHpp =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.reject_inventory_value_hpp ??
            0
        ),
      0
    );


  const detailTotalValueHpp =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.total_inventory_value_hpp ??
            0
        ),
      0
    );


  const detailPotentialSales =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.potential_sales_value ??
            0
        ),
      0
    );


  const detailPotentialGrossProfit =
    variants.reduce(
      (total, item) =>
        total +
        Number(
          item.potential_gross_profit ??
            0
        ),
      0
    );


  const detailMargin =
    detailPotentialSales > 0
      ? (
          detailPotentialGrossProfit /
          detailPotentialSales
        ) * 100
      : null;


  const totalPages = Math.max(
    Math.ceil(
      totalCount / pageSize
    ),
    1
  );


  // ============================================================
  // URL HELPERS
  // ============================================================

  const updateUrl = (
    nextPage: number,
    nextSearch: string,
    nextProduct: string
  ) => {
    const params =
      new URLSearchParams();

    if (nextSearch) {
      params.set(
        "q",
        nextSearch
      );
    }

    if (nextPage > 1) {
      params.set(
        "page",
        String(nextPage)
      );
    }

    if (nextProduct) {
      params.set(
        "product",
        nextProduct
      );
    }

    const query =
      params.toString();

    router.push(
      query
        ? `/products?${query}`
        : "/products"
    );
  };


  // ============================================================
  // SEARCH
  // ============================================================

  function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const nextSearch =
      searchInput.trim();

    setSearch(nextSearch);
    setCurrentPage(1);
    setSelectedProductId("");

    updateUrl(
      1,
      nextSearch,
      ""
    );
  }


  function handleReset() {
    setSearchInput("");
    setSearch("");
    setCurrentPage(1);
    setSelectedProductId("");

    updateUrl(
      1,
      "",
      ""
    );
  }


  // ============================================================
  // PRODUCT DETAIL
  // ============================================================

  function handleViewProduct(
    productId: string
  ) {
    setSelectedProductId(
      productId
    );

    updateUrl(
      currentPage,
      search,
      productId
    );
  }


  function handleCloseDetail() {
    setSelectedProductId("");

    updateUrl(
      currentPage,
      search,
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

    setCurrentPage(page);

    setSelectedProductId("");

    updateUrl(
      page,
      search,
      ""
    );
  }


  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">

      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />


        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">

          <div className="mx-auto w-full min-w-0 max-w-[1500px]">


            {/* ================================================= */}
            {/* HEADER */}
            {/* ================================================= */}

            <header className="mb-8">

              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Products
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Master produk dan variant Hi.PRIMA
              </p>

            </header>


            {/* ================================================= */}
            {/* ERROR */}
            {/* ================================================= */}

            {errorMessage && (

              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">

                {errorMessage}

              </div>

            )}


            {/* ================================================= */}
            {/* LOADING */}
            {/* ================================================= */}

            {loading && (

              <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="text-sm text-slate-500">
                  Memuat data Products...
                </div>

              </div>

            )}


            {/* ================================================= */}
            {/* PRODUCT DETAIL */}
            {/* ================================================= */}

            {!loading &&
              selectedProduct && (

                <section className="mb-6 w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">


                  {/* DETAIL HEADER */}

                  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

                    <div className="min-w-0">

                      <div className="text-sm text-slate-500">
                        Product Detail
                      </div>

                      <h2 className="mt-1 break-words text-2xl font-bold">
                        {
                          selectedProduct.product_name
                        }
                      </h2>

                      <div className="mt-1 text-sm text-slate-500">
                        {
                          selectedProduct.product_code
                        }

                        {" • "}

                        {
                          selectedProduct.brand ??
                          "-"
                        }
                      </div>

                    </div>


                    <button
                      type="button"
                      onClick={
                        handleCloseDetail
                      }
                      className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                    >
                      Close
                    </button>

                  </div>


                  {/* STOCK SUMMARY */}

                  <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                    <div className="rounded-xl bg-slate-50 p-4">

                      <div className="text-sm text-slate-500">
                        Normal
                      </div>

                      <div className="mt-2 text-xl font-bold">
                        {
                          formatNumber(
                            detailNormalQty
                          )
                        }
                      </div>

                    </div>


                    <div className="rounded-xl bg-slate-50 p-4">

                      <div className="text-sm text-slate-500">
                        Defect
                      </div>

                      <div className="mt-2 text-xl font-bold">
                        {
                          formatNumber(
                            detailDefectQty
                          )
                        }
                      </div>

                    </div>


                    <div className="rounded-xl bg-slate-50 p-4">

                      <div className="text-sm text-slate-500">
                        Reject
                      </div>

                      <div className="mt-2 text-xl font-bold">
                        {
                          formatNumber(
                            detailRejectQty
                          )
                        }
                      </div>

                    </div>


                    <div className="rounded-xl bg-slate-50 p-4">

                      <div className="text-sm text-slate-500">
                        Total Stock
                      </div>

                      <div className="mt-2 text-xl font-bold">
                        {
                          formatNumber(
                            detailTotalQty
                          )
                        }
                      </div>

                    </div>

                  </div>


                  {/* HPP VALUATION */}

                  <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Nilai HPP Normal
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatRupiah(
                            detailNormalValueHpp
                          )
                        }
                      </div>

                    </div>


                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Nilai HPP Defect
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatRupiah(
                            detailDefectValueHpp
                          )
                        }
                      </div>

                    </div>


                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Nilai HPP Reject
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatRupiah(
                            detailRejectValueHpp
                          )
                        }
                      </div>

                    </div>


                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Total Nilai HPP
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatRupiah(
                            detailTotalValueHpp
                          )
                        }
                      </div>

                    </div>

                  </div>


                  {/* PROFITABILITY */}

                  <div className="mb-6 grid gap-4 sm:grid-cols-3">

                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Potential Sales
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatRupiah(
                            detailPotentialSales
                          )
                        }
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        Normal stock saja
                      </div>

                    </div>


                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Potential Gross Profit
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatRupiah(
                            detailPotentialGrossProfit
                          )
                        }
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        Normal stock saja
                      </div>

                    </div>


                    <div className="rounded-xl border border-slate-200 p-4">

                      <div className="text-sm text-slate-500">
                        Margin
                      </div>

                      <div className="mt-2 text-lg font-bold">
                        {
                          formatPercent(
                            detailMargin
                          )
                        }
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        Berdasarkan potential sales
                      </div>

                    </div>

                  </div>


                  {/* VARIANT TABLE */}

                  <div className="w-full max-w-full overflow-x-auto">

                    <table className="w-full min-w-[1500px] text-left text-sm">

                      <thead className="bg-slate-50 text-slate-500">

                        <tr>

                          <th className="px-4 py-3">
                            SKU
                          </th>

                          <th className="px-4 py-3">
                            Variant
                          </th>

                          <th className="px-4 py-3 text-right">
                            HPP
                          </th>

                          <th className="px-4 py-3 text-right">
                            Harga Jual
                          </th>

                          <th className="px-4 py-3 text-right">
                            Gross Profit
                          </th>

                          <th className="px-4 py-3 text-right">
                            Margin
                          </th>

                          <th className="px-4 py-3 text-right">
                            Normal
                          </th>

                          <th className="px-4 py-3 text-right">
                            Defect
                          </th>

                          <th className="px-4 py-3 text-right">
                            Reject
                          </th>

                          <th className="px-4 py-3 text-right">
                            Total
                          </th>

                          <th className="px-4 py-3">
                            Location
                          </th>

                        </tr>

                      </thead>


                      <tbody className="divide-y divide-slate-100">

                        {variants.map(
                          (variant) => (

                            <tr
                              key={
                                variant.variant_id
                              }
                              className="align-top hover:bg-slate-50"
                            >

                              <td className="px-4 py-3 font-semibold">
                                {
                                  variant.sku
                                }
                              </td>


                              <td className="px-4 py-3">

                                <div>
                                  {
                                    variant.color ??
                                    "-"
                                  }
                                </div>

                                <div className="text-xs text-slate-400">
                                  Size:{" "}
                                  {
                                    variant.size ??
                                    "-"
                                  }
                                </div>

                              </td>


                              <td className="whitespace-nowrap px-4 py-3 text-right">
                                {
                                  formatRupiah(
                                    variant.hpp
                                  )
                                }
                              </td>


                              <td className="whitespace-nowrap px-4 py-3 text-right">
                                {
                                  formatRupiah(
                                    variant.selling_price
                                  )
                                }
                              </td>


                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                                {
                                  formatRupiah(
                                    variant.gross_profit
                                  )
                                }
                              </td>


                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                                {
                                  formatPercent(
                                    variant.margin_pct
                                  )
                                }
                              </td>


                              <td className="px-4 py-3 text-right">
                                {
                                  formatNumber(
                                    variant.normal_qty
                                  )
                                }
                              </td>


                              <td className="px-4 py-3 text-right">
                                {
                                  formatNumber(
                                    variant.defect_qty
                                  )
                                }
                              </td>


                              <td className="px-4 py-3 text-right">
                                {
                                  formatNumber(
                                    variant.reject_qty
                                  )
                                }
                              </td>


                              <td className="px-4 py-3 text-right font-bold">
                                {
                                  formatNumber(
                                    variant.total_qty
                                  )
                                }
                              </td>


                              <td className="px-4 py-3 text-xs">

                                {variant.normal_locations && (

                                  <div>
                                    N:{" "}
                                    {
                                      variant.normal_locations
                                    }
                                  </div>

                                )}


                                {variant.defect_locations && (

                                  <div className="text-amber-700">
                                    D:{" "}
                                    {
                                      variant.defect_locations
                                    }
                                  </div>

                                )}


                                {variant.reject_locations && (

                                  <div className="text-red-700">
                                    R:{" "}
                                    {
                                      variant.reject_locations
                                    }
                                  </div>

                                )}


                                {!variant.normal_locations &&
                                  !variant.defect_locations &&
                                  !variant.reject_locations && (

                                    <span className="text-slate-400">
                                      -
                                    </span>

                                  )}

                              </td>

                            </tr>

                          )
                        )}


                        {variants.length === 0 && (

                          <tr>

                            <td
                              colSpan={11}
                              className="px-4 py-10 text-center text-slate-400"
                            >
                              Tidak ada variant.
                            </td>

                          </tr>

                        )}

                      </tbody>

                    </table>

                  </div>

                </section>

              )}


            {/* ================================================= */}
            {/* SEARCH */}
            {/* ================================================= */}

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form
                onSubmit={handleSearch}
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >

                <input
                  name="q"
                  value={searchInput}
                  onChange={(event) =>
                    setSearchInput(
                      event.target.value
                    )
                  }
                  placeholder="Cari kode produk, nama produk, atau brand..."
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
                    onClick={handleReset}
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-sm hover:bg-slate-50"
                  >
                    Reset
                  </button>

                )}

              </form>

            </section>


            {/* ================================================= */}
            {/* PRODUCT LIST */}
            {/* ================================================= */}

            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">


              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">

                <div>

                  <h2 className="text-lg font-semibold">
                    Product List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {
                      formatNumber(
                        totalCount
                      )
                    }{" "}
                    produk ditemukan
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


              <div className="w-full max-w-full overflow-x-auto">

                <table className="w-full min-w-[700px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">

                    <tr>

                      <th className="px-5 py-4">
                        Product
                      </th>

                      <th className="px-5 py-4">
                        Brand
                      </th>

                      <th className="px-5 py-4 text-right">
                        Variants
                      </th>

                      <th className="px-5 py-4 text-right">
                        Stock
                      </th>

                      <th className="px-5 py-4"></th>

                    </tr>

                  </thead>


                  <tbody className="divide-y divide-slate-100">

                    {products.map(
                      (product) => (

                        <tr
                          key={
                            product.product_id
                          }
                          className="hover:bg-slate-50"
                        >

                          <td className="px-5 py-4">

                            <div className="font-semibold">
                              {
                                product.product_name
                              }
                            </div>

                            <div className="text-xs text-slate-400">
                              {
                                product.product_code
                              }
                            </div>

                          </td>


                          <td className="px-5 py-4">
                            {
                              product.brand ??
                              "-"
                            }
                          </td>


                          <td className="px-5 py-4 text-right">
                            {
                              formatNumber(
                                product.variant_count
                              )
                            }
                          </td>


                          <td className="px-5 py-4 text-right font-semibold">
                            {
                              formatNumber(
                                product.total_qty
                              )
                            }
                          </td>


                          <td className="px-5 py-4 text-right">

                            <button
                              type="button"
                              onClick={() =>
                                handleViewProduct(
                                  product.product_id
                                )
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50"
                            >
                              View
                            </button>

                          </td>

                        </tr>

                      )
                    )}


                    {!loading &&
                      products.length === 0 && (

                        <tr>

                          <td
                            colSpan={5}
                            className="px-5 py-12 text-center text-slate-500"
                          >
                            Tidak ada produk ditemukan.
                          </td>

                        </tr>

                      )}

                  </tbody>

                </table>

              </div>


              {/* PAGINATION */}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">

                <div className="text-sm text-slate-500">
                  Menampilkan maksimal{" "}
                  {pageSize}{" "}
                  produk per halaman
                </div>


                <div className="flex shrink-0 gap-2">

                  <button
                    type="button"
                    disabled={
                      currentPage <= 1
                    }
                    onClick={() =>
                      handlePageChange(
                        currentPage - 1
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
                        currentPage + 1
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