import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";

type ProductRow = {
  product_id: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  variant_count: number;
  total_qty: number;
  total_count: number;
};

type VariantRow = {
  variant_id: string;
  sku: string;
  color: string | null;
  size: string | null;
  barcode: string | null;
  normal_qty: number;
  defect_qty: number;
  reject_qty: number;
  total_qty: number;
  normal_locations: string | null;
  defect_locations: string | null;
  reject_locations: string | null;
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    product?: string;
  }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;

  const search = params.q?.trim() ?? "";
  const productId = params.product ?? "";

  const currentPage = Math.max(
    Number(params.page ?? "1") || 1,
    1
  );

  const pageSize = 50;
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
    throw new Error(
      `Products error: ${error.message}`
    );
  }

  const products = (data ?? []) as ProductRow[];

  const totalCount = Number(
    products[0]?.total_count ?? 0
  );

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  let selectedProduct: ProductRow | null = null;
  let variants: VariantRow[] = [];

  if (productId) {
    selectedProduct =
      products.find(
        (item) =>
          item.product_id === productId
      ) ?? null;

    if (!selectedProduct) {
      const { data: productData } =
        await supabase
          .from("products")
          .select(
            "id, product_code, name, brand"
          )
          .eq("id", productId)
          .single();

      if (productData) {
        selectedProduct = {
          product_id: productData.id,
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
    }

    const {
      data: variantData,
      error: variantError,
    } = await supabase.rpc(
      "get_product_variants",
      {
        p_product_id: productId,
      }
    );

    if (variantError) {
      throw new Error(
        `Product variants error: ${variantError.message}`
      );
    }

    variants =
      (variantData ?? []) as VariantRow[];
  }

  const formatNumber = (value: number) =>
    Number(value ?? 0).toLocaleString(
      "id-ID"
    );

  const detailTotalQty = variants.reduce(
    (total, item) =>
      total +
      Number(item.total_qty ?? 0),
    0
  );

  const makePageUrl = (page: number) => {
    const query =
      new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    query.set(
      "page",
      String(page)
    );

    return `/products?${query.toString()}`;
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">

      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 p-6 md:p-10">

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

            {selectedProduct && (
              <section className="mb-6 w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-500">
                      Product Detail
                    </div>

                    <h2 className="mt-1 break-words text-2xl font-bold">
                      {selectedProduct.product_name}
                    </h2>

                    <div className="mt-1 text-sm text-slate-500">
                      {selectedProduct.product_code}
                      {" • "}
                      {selectedProduct.brand ?? "-"}
                    </div>
                  </div>

                  <Link
                    href="/products"
                    className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-center text-sm"
                  >
                    Close
                  </Link>
                </div>

                <div className="mb-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Variants / SKU
                    </div>

                    <div className="mt-2 text-xl font-bold">
                      {formatNumber(
                        variants.length
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Total Stock
                    </div>

                    <div className="mt-2 text-xl font-bold">
                      {formatNumber(
                        detailTotalQty
                      )}
                    </div>
                  </div>
                </div>

                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3">
                          SKU
                        </th>

                        <th className="px-4 py-3">
                          Variant
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
                              {variant.sku}
                            </td>

                            <td className="px-4 py-3">
                              <div>
                                {variant.color ?? "-"}
                              </div>

                              <div className="text-xs text-slate-400">
                                Size: {variant.size ?? "-"}
                              </div>
                            </td>

                            <td className="px-4 py-3 text-right">
                              {formatNumber(
                                variant.normal_qty
                              )}
                            </td>

                            <td className="px-4 py-3 text-right">
                              {formatNumber(
                                variant.defect_qty
                              )}
                            </td>

                            <td className="px-4 py-3 text-right">
                              {formatNumber(
                                variant.reject_qty
                              )}
                            </td>

                            <td className="px-4 py-3 text-right font-bold">
                              {formatNumber(
                                variant.total_qty
                              )}
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
                    </tbody>
                  </table>
                </div>

              </section>
            )}

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                action="/products"
                method="GET"
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >
                <input
                  name="q"
                  defaultValue={search}
                  placeholder="Cari kode produk, nama produk, atau brand..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />

                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {search && (
                  <Link
                    href="/products"
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                  >
                    Reset
                  </Link>
                )}
              </form>
            </section>

            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Product List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {formatNumber(totalCount)} produk ditemukan
                  </p>
                </div>

                <div className="shrink-0 text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </div>
              </div>

              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full text-left text-sm">
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
                            {formatNumber(
                              product.variant_count
                            )}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold">
                            {formatNumber(
                              product.total_qty
                            )}
                          </td>

                          <td className="px-5 py-4 text-right">
                            <Link
                              href={`/products?product=${product.product_id}`}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      )
                    )}

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

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} produk per halaman
                </div>

                <div className="flex shrink-0 gap-2">
                  {currentPage > 1 ? (
                    <Link
                      href={makePageUrl(
                        currentPage - 1
                      )}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-300">
                      Previous
                    </span>
                  )}

                  {currentPage < totalPages ? (
                    <Link
                      href={makePageUrl(
                        currentPage + 1
                      )}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-300">
                      Next
                    </span>
                  )}
                </div>
              </div>

            </section>

          </div>
        </main>
      </div>
    </div>
  );
}