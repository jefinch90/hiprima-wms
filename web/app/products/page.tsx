import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

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
  const currentPage = Math.max(Number(params.page ?? "1") || 1, 1);

  const pageSize = 50;
  const offset = (currentPage - 1) * pageSize;

  const { data, error } = await supabase.rpc("get_products_list", {
    p_search: search || null,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    throw new Error(`Products error: ${error.message}`);
  }

  const products = (data ?? []) as ProductRow[];

  const totalCount = Number(products[0]?.total_count ?? 0);
  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

  let selectedProduct: ProductRow | null = null;
  let variants: VariantRow[] = [];

  if (productId) {
    selectedProduct =
      products.find((item) => item.product_id === productId) ?? null;

    if (!selectedProduct) {
      const { data: productData } = await supabase
        .from("products")
        .select("id, product_code, name, brand")
        .eq("id", productId)
        .single();

      if (productData) {
        selectedProduct = {
          product_id: productData.id,
          product_code: productData.product_code,
          product_name: productData.name,
          brand: productData.brand,
          variant_count: 0,
          total_qty: 0,
          total_count: 0,
        };
      }
    }

    const { data: variantData, error: variantError } =
      await supabase.rpc("get_product_variants", {
        p_product_id: productId,
      });

    if (variantError) {
      throw new Error(
        `Product variants error: ${variantError.message}`
      );
    }

    variants = (variantData ?? []) as VariantRow[];
  }

  const formatNumber = (value: number) =>
    Number(value ?? 0).toLocaleString("id-ID");

  const detailTotalQty = variants.reduce(
    (total, item) => total + Number(item.total_qty ?? 0),
    0
  );

  const makePageUrl = (page: number) => {
    const query = new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    query.set("page", String(page));

    return `/products?${query.toString()}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">

        {/* SIDEBAR */}
        <aside className="hidden w-64 border-r border-slate-200 bg-white p-6 lg:block">
          <div className="mb-10">
            <div className="text-xl font-bold">
              Hi.PRIMA
            </div>

            <div className="text-sm text-slate-500">
              Warehouse Management System
            </div>
          </div>

          <nav className="space-y-2">
            <Link
              href="/"
              className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              Dashboard
            </Link>

            <Link
              href="/products"
              className="block rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
            >
              Products
            </Link>

            <Link
              href="/inventory"
              className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              Inventory
            </Link>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Stock Movement
            </div>

            <Link
              href="/locations"
              className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              Locations
            </Link>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Users
            </div>
          </nav>
        </aside>

        <main className="flex-1 p-6 md:p-10">
          <div className="mx-auto max-w-[1500px]">

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

            {/* PRODUCT DETAIL */}
            {selectedProduct && (
              <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <div className="text-sm text-slate-500">
                      Product Detail
                    </div>

                    <h2 className="mt-1 text-2xl font-bold">
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
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
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

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left text-sm">

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
                        <th className="px-4 py-3">
                          Location
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {variants.map((variant) => (
                        <tr key={variant.variant_id}>
                          <td className="px-4 py-3 font-semibold">
                            {variant.sku}
                          </td>

                          <td className="px-4 py-3">
                            <div>{variant.color ?? "-"}</div>

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

                            {!variant.normal_locations &&
                              !variant.defect_locations &&
                              !variant.reject_locations && (
                                <span className="text-slate-400">
                                  -
                                </span>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>

                  </table>
                </div>

              </section>
            )}

            {/* SEARCH */}
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form
                action="/products"
                method="GET"
                className="flex gap-3"
              >
                <input
                  name="q"
                  defaultValue={search}
                  placeholder="Cari kode produk, nama produk, atau brand..."
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />

                <button className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white">
                  Search
                </button>

                {search && (
                  <Link
                    href="/products"
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm"
                  >
                    Reset
                  </Link>
                )}
              </form>

            </section>

            {/* PRODUCT LIST */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex justify-between border-b border-slate-200 p-6">
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

              <div className="overflow-x-auto">
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
                          <Link
                            href={`/products?product=${product.product_id}`}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              <div className="flex items-center justify-between border-t border-slate-200 p-5">

                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} produk per halaman
                </div>

                <div className="flex gap-2">

                  {currentPage > 1 ? (
                    <Link
                      href={makePageUrl(currentPage - 1)}
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
                      href={makePageUrl(currentPage + 1)}
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