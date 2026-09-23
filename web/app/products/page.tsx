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

type VariantRow = {
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

export default function ProductsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedProduct, setSelectedProduct] =
    useState<ProductRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    const offset = (currentPage - 1) * pageSize;

    const { data, error } = await supabase.rpc(
      "get_products_list",
      {
        p_search: search || null,
        p_limit: pageSize,
        p_offset: offset,
      }
    );

    if (error) {
      setProducts([]);
      setTotalCount(0);
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ProductRow[];

    setProducts(rows);
    setTotalCount(Number(rows[0]?.total_count ?? 0));
    setLoading(false);
  }, [currentPage, router, search, supabase]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  const formatNumber = (
    value: number | string | null | undefined
  ) => Number(value ?? 0).toLocaleString("id-ID");

  const detailTotalQty = variants.reduce(
    (total, item) =>
      total + Number(item.total_qty ?? 0),
    0
  );

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSelectedProduct(null);
    setVariants([]);
    setCurrentPage(1);
    setSearch(searchInput.trim());
  }

  function handleReset() {
    setSearchInput("");
    setSearch("");
    setCurrentPage(1);
    setSelectedProduct(null);
    setVariants([]);
    setErrorMessage("");
  }

  async function handleSelectProduct(product: ProductRow) {
    setSelectedProduct(product);
    setVariants([]);
    setDetailLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "get_product_variants",
      {
        p_product_id: product.product_id,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setDetailLoading(false);
      return;
    }

    setVariants((data ?? []) as VariantRow[]);
    setDetailLoading(false);
  }

  function changePage(page: number) {
    setSelectedProduct(null);
    setVariants([]);
    setCurrentPage(page);
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1500px]">

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

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {selectedProduct && (
              <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm text-slate-500">
                      Product Detail
                    </div>

                    <h2 className="mt-1 text-2xl font-bold">
                      {selectedProduct.product_name}
                    </h2>

                    <div className="mt-1 text-sm text-slate-500">
                      {selectedProduct.product_code} •{" "}
                      {selectedProduct.brand ?? "-"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProduct(null);
                      setVariants([]);
                    }}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
                  >
                    Close
                  </button>
                </div>

                <div className="mb-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Variants / SKU
                    </div>
                    <div className="mt-2 text-xl font-bold">
                      {formatNumber(variants.length)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Total Stock
                    </div>
                    <div className="mt-2 text-xl font-bold">
                      {formatNumber(detailTotalQty)}
                    </div>
                  </div>
                </div>

                {detailLoading ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Memuat variant...
                  </div>
                ) : (
                  <div className="w-full max-w-full overflow-x-auto">
                    <table className="w-full min-w-[1000px] text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">SKU</th>
                          <th className="px-4 py-3">Variant</th>
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
                          <th className="px-4 py-3">Location</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {variants.map((variant) => (
                          <tr
                            key={variant.variant_id}
                            className="align-top"
                          >
                            <td className="px-4 py-3 font-semibold">
                              {variant.sku}
                            </td>

                            <td className="px-4 py-3">
                              {variant.color ?? "-"}
                              <div className="text-xs text-slate-400">
                                Size: {variant.size ?? "-"}
                              </div>
                            </td>

                            <td className="px-4 py-3 text-right">
                              {formatNumber(variant.normal_qty)}
                            </td>

                            <td className="px-4 py-3 text-right">
                              {formatNumber(variant.defect_qty)}
                            </td>

                            <td className="px-4 py-3 text-right">
                              {formatNumber(variant.reject_qty)}
                            </td>

                            <td className="px-4 py-3 text-right font-bold">
                              {formatNumber(variant.total_qty)}
                            </td>

                            <td className="px-4 py-3 text-xs">
                              {variant.normal_locations && (
                                <div>
                                  N: {variant.normal_locations}
                                </div>
                              )}

                              {variant.defect_locations && (
                                <div className="text-amber-700">
                                  D: {variant.defect_locations}
                                </div>
                              )}

                              {variant.reject_locations && (
                                <div className="text-red-700">
                                  R: {variant.reject_locations}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              </section>
            )}

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                onSubmit={handleSearch}
                className="flex flex-col gap-3 lg:flex-row"
              >
                <input
                  value={searchInput}
                  onChange={(event) =>
                    setSearchInput(event.target.value)
                  }
                  placeholder="Cari kode produk, nama produk, atau brand..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />

                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {search && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm"
                  >
                    Reset
                  </button>
                )}
              </form>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Product List
                  </h2>
                  <p className="text-sm text-slate-500">
                    {formatNumber(totalCount)} produk ditemukan
                  </p>
                </div>

                <div className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </div>
              </div>

              {loading ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  Memuat products...
                </div>
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Product</th>
                        <th className="px-5 py-4">Brand</th>
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
                      {products.map((product) => (
                        <tr
                          key={product.product_id}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold">
                              {product.product_name}
                            </div>
                            <div className="text-xs text-slate-400">
                              {product.product_code}
                            </div>
                          </td>

                          <td className="px-5 py-4">
                            {product.brand ?? "-"}
                          </td>

                          <td className="px-5 py-4 text-right">
                            {formatNumber(product.variant_count)}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold">
                            {formatNumber(product.total_qty)}
                          </td>

                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                handleSelectProduct(product)
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}

                      {products.length === 0 && (
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
              )}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Maksimal {pageSize} produk per halaman
                </div>

                <div className="flex gap-2">
                  <button
                    disabled={currentPage <= 1}
                    onClick={() =>
                      changePage(
                        Math.max(currentPage - 1, 1)
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Previous
                  </button>

                  <button
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      changePage(
                        Math.min(
                          currentPage + 1,
                          totalPages
                        )
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:border-slate-200 disabled:text-slate-300"
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