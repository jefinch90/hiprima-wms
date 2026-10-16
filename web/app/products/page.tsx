"use client";



import {

  FormEvent,

  type PointerEvent as ReactPointerEvent,

  useCallback,

  useEffect,

  useMemo,

  useRef,

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



type VariantMaster = {

  id: string;

  sku: string;

  color: string | null;

  size: string | null;

  barcode: string | null;

  hpp: number | string | null;

  selling_price: number | string | null;

  cost_price: number | string | null;

  is_active: boolean;

  lifecycle_status: string | null;

  development_date: string | null;

  launch_date: string | null;

  planned_discontinue_date: string | null;

  discontinue_date: string | null;

  discontinue_reason: string | null;

  first_stock_in_date: string | null;

  first_sale_date: string | null;

  last_stock_in_date: string | null;

  last_sale_date: string | null;

};



type ProductMaster = {

  id: string;

  product_code: string;

  name: string;

  category_id: string | null;

  brand: string | null;

  is_active: boolean;

  image_path: string | null;

  lifecycle_status: string | null;

  first_stock_in_date: string | null;

  first_sale_date: string | null;

  last_stock_in_date: string | null;

  last_sale_date: string | null;

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

  lifecycle_status: string | null;

  development_date: string | null;

  launch_date: string | null;

  planned_discontinue_date: string | null;

  discontinue_date: string | null;

  discontinue_reason: string | null;

  first_stock_in_date: string | null;

  first_sale_date: string | null;

  last_stock_in_date: string | null;

  last_sale_date: string | null;

  is_active: boolean;

};



type PriceHistoryRow = {
  id: string;
  variant_id: string;
  price_type: string | null;
  amount: number | string | null;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  hpp: number | string | null;
  selling_price: number | string | null;
  change_type: string | null;
  change_reason: string | null;
  changed_by: string | null;
};


type CategoryRow = {

  id: string;

  name: string;

};



type ProductForm = {

  product_code: string;

  name: string;

  brand: string;

  category_id: string;

  lifecycle_status: string;

  is_active: boolean;

};



type VariantForm = {

  sku: string;

  color: string;

  size: string;

  barcode: string;

  hpp: string;

  selling_price: string;

  lifecycle_status: string;

  is_active: boolean;

};







const EMPTY_PRODUCT_FORM: ProductForm = {

  product_code: "",

  name: "",

  brand: "Hi.PRIMA",

  category_id: "",

  lifecycle_status: "draft",

  is_active: true,

};



const EMPTY_VARIANT_FORM: VariantForm = {

  sku: "",

  color: "",

  size: "",

  barcode: "",

  hpp: "",

  selling_price: "",

  lifecycle_status: "draft",

  is_active: true,

};





const VARIANT_LIFECYCLE_OPTIONS = [

  "draft",

  "active",

  "discontinued",

];



function lifecycleOptionsForValue(currentValue: string | null | undefined) {

  const value = currentValue?.trim() ?? "";

  if (!value || VARIANT_LIFECYCLE_OPTIONS.includes(value)) return VARIANT_LIFECYCLE_OPTIONS;

  // Compatibility for older records: keep the legacy value visible until the user

  // explicitly changes it to one of the three final lifecycle statuses.

  return [value, ...VARIANT_LIFECYCLE_OPTIONS];

}



function formatNumber(value: number | string | null | undefined) {

  return Number(value ?? 0).toLocaleString("id-ID");

}



function formatRupiah(value: number | string | null | undefined) {

  return `Rp ${Number(value ?? 0).toLocaleString("id-ID")}`;

}



function formatPercent(value: number | string | null | undefined) {

  if (value === null || value === undefined || value === "") return "-";

  return `${Number(value).toLocaleString("id-ID", {

    minimumFractionDigits: 2,

    maximumFractionDigits: 2,

  })}%`;

}



function formatDate(value: string | null | undefined) {

  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("id-ID", {

    day: "2-digit",

    month: "short",

    year: "numeric",

  });

}



function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


function priceChangeSummary(current: PriceHistoryRow, previous: PriceHistoryRow | null) {
  if (current.change_type === "baseline" || !previous) return "Baseline";

  const parts: string[] = [];
  const hppDiff = Number(current.hpp ?? 0) - Number(previous.hpp ?? 0);
  const sellingDiff = Number(current.selling_price ?? 0) - Number(previous.selling_price ?? 0);

  if (hppDiff !== 0) {
    parts.push(`HPP ${hppDiff > 0 ? "↑" : "↓"} ${formatRupiah(Math.abs(hppDiff))}`);
  }

  if (sellingDiff !== 0) {
    parts.push(`Harga ${sellingDiff > 0 ? "↑" : "↓"} ${formatRupiah(Math.abs(sellingDiff))}`);
  }

  return parts.length ? parts.join(" • ") : "Tidak berubah";
}


function shortUserId(value: string | null | undefined) {
  if (!value) return "System";
  return `${value.slice(0, 8)}…`;
}


function lifecycleLabel(value: string | null | undefined) {

  if (!value) return "Belum di-set";

  const labels: Record<string, string> = {

    draft: "Draft",

    active: "Active",

    discontinued: "Discontinued",

    development: "Development",

    slow_moving: "Slow Moving",

    clearance: "Clearance",

    archived: "Archived",

  };

  return labels[value] ?? value.replaceAll("_", " ");

}



async function compressImage(file: File) {

  if (!file.type.startsWith("image/")) {

    throw new Error("File harus berupa gambar.");

  }



  const dataUrl = await new Promise<string>((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));

    reader.onerror = () => reject(new Error("Gagal membaca gambar."));

    reader.readAsDataURL(file);

  });



  const image = await new Promise<HTMLImageElement>((resolve, reject) => {

    const img = new Image();

    img.onload = () => resolve(img);

    img.onerror = () => reject(new Error("Gambar tidak dapat diproses."));

    img.src = dataUrl;

  });



  const maxSize = 1600;

  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));

  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(image.width * scale));

  canvas.height = Math.max(1, Math.round(image.height * scale));



  const context = canvas.getContext("2d");

  if (!context) throw new Error("Browser tidak mendukung kompresi gambar.");



  context.drawImage(image, 0, 0, canvas.width, canvas.height);



  return await new Promise<Blob>((resolve, reject) => {

    canvas.toBlob(

      (blob) => {

        if (!blob) {

          reject(new Error("Gagal mengompres gambar."));

          return;

        }

        resolve(blob);

      },

      "image/jpeg",

      0.82

    );

  });

}



export default function ProductsPage() {

  const router = useRouter();

  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;



  const [products, setProducts] = useState<ProductRow[]>([]);

  const [variants, setVariants] = useState<DetailVariant[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
  const [priceHistoryError, setPriceHistoryError] = useState("");
  const [userDisplayNames, setUserDisplayNames] = useState<Record<string, string>>({});

  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [productMaster, setProductMaster] = useState<ProductMaster | null>(null);



  const [searchInput, setSearchInput] = useState("");

  const [search, setSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);

  const [selectedProductId, setSelectedProductId] = useState("");

  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);

  const [totalCount, setTotalCount] = useState(0);

  const [loading, setLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  const [urlReady, setUrlReady] = useState(false);

  const [role, setRole] = useState("");



  const [showProductEditor, setShowProductEditor] = useState(false);

  const [editingProduct, setEditingProduct] = useState<ProductMaster | null>(null);

  const [productForm, setProductForm] = useState<ProductForm>(EMPTY_PRODUCT_FORM);

  const [productImageFile, setProductImageFile] = useState<File | null>(null);

  const [productImagePreview, setProductImagePreview] = useState("");

  const [savingProduct, setSavingProduct] = useState(false);



  const [showVariantEditor, setShowVariantEditor] = useState(false);

  const [editingVariant, setEditingVariant] = useState<DetailVariant | null>(null);

  const [variantForm, setVariantForm] = useState<VariantForm>(EMPTY_VARIANT_FORM);

  const [savingVariant, setSavingVariant] = useState(false);





  const [showImageZoom, setShowImageZoom] = useState(false);

  const [imageZoom, setImageZoom] = useState(1);

  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });

  const [isDraggingImage, setIsDraggingImage] = useState(false);

  const imageDragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });



  const canManageMaster = role === "owner" || role === "admin";



  useEffect(() => {

    const params = new URLSearchParams(window.location.search);

    setSearchInput(params.get("q")?.trim() ?? "");

    setSearch(params.get("q")?.trim() ?? "");

    setCurrentPage(Math.max(Number(params.get("page") ?? "1") || 1, 1));

    setSelectedProductId(params.get("product") ?? "");

    setUrlReady(true);

  }, []);



  useEffect(() => {

    async function loadUserMeta() {

      const {

        data: { user },

      } = await supabase.auth.getUser();



      if (!user) {

        router.replace("/login");

        return;

      }



      const [{ data: profileData }, { data: categoryData }] = await Promise.all([

        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),

        supabase.from("categories").select("id, name").order("name"),

      ]);



      setRole(profileData?.role ?? "viewer");

      setCategories((categoryData ?? []) as CategoryRow[]);

    }



    loadUserMeta();

  }, [router, supabase]);



  const loadProducts = useCallback(async () => {

    if (!urlReady) return;



    setLoading(true);

    setErrorMessage("");



    const offset = (currentPage - 1) * pageSize;

    const { data, error } = await supabase.rpc("get_products_list", {

      p_search: search || null,

      p_limit: pageSize,

      p_offset: offset,

    });



    if (error) {

      setProducts([]);

      setTotalCount(0);

      setSelectedProduct(null);

      setProductMaster(null);

      setVariants([]);

      setErrorMessage(`Products error: ${error.message}`);

      setLoading(false);

      return;

    }



    const rows = (data ?? []) as ProductRow[];

    setProducts(rows);

    setTotalCount(Number(rows[0]?.total_count ?? 0));



    if (!selectedProductId) {

      setSelectedProduct(null);

      setProductMaster(null);

      setVariants([]);

      setLoading(false);

      return;

    }



    let product = rows.find((item) => item.product_id === selectedProductId) ?? null;



    const { data: productData, error: productError } = await supabase

      .from("products")

      .select(

        "id, product_code, name, category_id, brand, is_active, image_path, lifecycle_status, first_stock_in_date, first_sale_date, last_stock_in_date, last_sale_date"

      )

      .eq("id", selectedProductId)

      .maybeSingle();



    if (productError || !productData) {

      setSelectedProduct(null);

      setProductMaster(null);

      setVariants([]);

      setErrorMessage(productError?.message ?? "Produk tidak ditemukan.");

      setLoading(false);

      return;

    }



    const master = productData as ProductMaster;

    setProductMaster(master);



    if (!product) {

      product = {

        product_id: master.id,

        product_code: master.product_code,

        product_name: master.name,

        brand: master.brand,

        variant_count: 0,

        total_qty: 0,

        total_count: 0,

      };

    }



    setSelectedProduct(product);



    const [stockResult, profitabilityResult, variantMetaResult] = await Promise.all([

      supabase.rpc("get_product_variants", { p_product_id: selectedProductId }),

      supabase.rpc("get_product_profitability", { p_product_id: selectedProductId }),

      supabase

        .from("product_variants")

        .select(

          "id, sku, color, size, barcode, hpp, selling_price, cost_price, is_active, lifecycle_status, development_date, launch_date, planned_discontinue_date, discontinue_date, discontinue_reason, first_stock_in_date, first_sale_date, last_stock_in_date, last_sale_date"

        )

        .eq("product_id", selectedProductId)

        .order("sku"),

    ]);



    if (stockResult.error) {

      setVariants([]);

      setErrorMessage(`Product variants error: ${stockResult.error.message}`);

      setLoading(false);

      return;

    }



    if (profitabilityResult.error) {

      setVariants([]);

      setErrorMessage(`Product profitability error: ${profitabilityResult.error.message}`);

      setLoading(false);

      return;

    }



    if (variantMetaResult.error) {

      setVariants([]);

      setErrorMessage(`Variant master error: ${variantMetaResult.error.message}`);

      setLoading(false);

      return;

    }



    const stockRows = (stockResult.data ?? []) as VariantStockRow[];

    const profitabilityRows = (profitabilityResult.data ?? []) as ProfitabilityRow[];

    const metaRows = (variantMetaResult.data ?? []) as VariantMaster[];

    const metaMap = new Map(metaRows.map((row) => [row.id, row]));

    const profitabilityMap = new Map(profitabilityRows.map((row) => [row.variant_id, row]));



    const merged = stockRows.map((stockRow) => {

      const profit = profitabilityMap.get(stockRow.variant_id);

      const meta = metaMap.get(stockRow.variant_id);

      return {

        ...stockRow,

        hpp: Number(profit?.hpp ?? meta?.hpp ?? 0),

        selling_price: Number(profit?.selling_price ?? meta?.selling_price ?? 0),

        gross_profit: Number(profit?.gross_profit ?? 0),

        margin_pct: profit?.margin_pct == null ? null : Number(profit.margin_pct),

        normal_inventory_value_hpp: Number(profit?.normal_inventory_value_hpp ?? 0),

        defect_inventory_value_hpp: Number(profit?.defect_inventory_value_hpp ?? 0),

        reject_inventory_value_hpp: Number(profit?.reject_inventory_value_hpp ?? 0),

        total_inventory_value_hpp: Number(profit?.total_inventory_value_hpp ?? 0),

        potential_sales_value: Number(profit?.potential_sales_value ?? 0),

        potential_gross_profit: Number(profit?.potential_gross_profit ?? 0),

        lifecycle_status: meta?.lifecycle_status ?? null,

        development_date: meta?.development_date ?? null,

        launch_date: meta?.launch_date ?? null,

        planned_discontinue_date: meta?.planned_discontinue_date ?? null,

        discontinue_date: meta?.discontinue_date ?? null,

        discontinue_reason: meta?.discontinue_reason ?? null,

        first_stock_in_date: meta?.first_stock_in_date ?? null,

        first_sale_date: meta?.first_sale_date ?? null,

        last_stock_in_date: meta?.last_stock_in_date ?? null,

        last_sale_date: meta?.last_sale_date ?? null,

        is_active: meta?.is_active ?? true,

      } as DetailVariant;

    });



    setVariants(merged);

    const variantIds = metaRows.map((row) => row.id);

    if (variantIds.length === 0) {
      setPriceHistory([]);
      setPriceHistoryError("");
    } else {
      const { data: historyData, error: historyError } = await supabase
        .from("product_variant_price_history")
        .select(
          "id, variant_id, price_type, amount, effective_from, effective_to, created_by, created_at, hpp, selling_price, change_type, change_reason, changed_by"
        )
        .in("variant_id", variantIds)
        .order("created_at", { ascending: false })
        .limit(500);

      if (historyError) {
        setPriceHistory([]);
        setPriceHistoryError(`Riwayat harga tidak dapat dimuat: ${historyError.message}`);
      } else {
        const historyRows = (historyData ?? []) as PriceHistoryRow[];

        setPriceHistory(historyRows);
        setPriceHistoryError("");

        const userIds = Array.from(
          new Set(
            historyRows
              .flatMap((item) => [item.changed_by, item.created_by])
              .filter((id): id is string => Boolean(id))
          )
        );

        const names: Record<string, string> = {};

        // Nama/email user yang sedang login sebagai fallback
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();

        if (currentUser) {
          const metadata = currentUser.user_metadata ?? {};
          const currentName =
            typeof metadata.full_name === "string" && metadata.full_name.trim()
              ? metadata.full_name.trim()
              : typeof metadata.name === "string" && metadata.name.trim()
              ? metadata.name.trim()
              : currentUser.email ?? "";

          if (currentName) {
            names[currentUser.id] = currentName;
          }
        }

        // Cari nama user dari tabel profiles
        if (userIds.length > 0) {
          const { data: profileRows } = await supabase
            .from("profiles")
            .select("*")
            .in("id", userIds);

          (profileRows ?? []).forEach((profile) => {
            const row = profile as Record<string, unknown>;
            const id = typeof row.id === "string" ? row.id : "";

            if (!id) return;

            const first =
              typeof row.first_name === "string"
                ? row.first_name.trim()
                : "";

            const last =
              typeof row.last_name === "string"
                ? row.last_name.trim()
                : "";

            const combined = `${first} ${last}`.trim();

            const candidates = [
              row.full_name,
              row.name,
              row.display_name,
              row.username,
              combined,
              row.email,
            ];

            const display = candidates.find(
              (value): value is string =>
                typeof value === "string" && value.trim().length > 0
            );

            if (display) {
              names[id] = display.trim();
            }
          });
        }

        setUserDisplayNames(names);
      }
    }

    setLoading(false);
  }, [currentPage, search, selectedProductId, supabase, urlReady]);



  useEffect(() => {

    loadProducts();

  }, [loadProducts]);



  const detailNormalQty = variants.reduce((total, item) => total + Number(item.normal_qty ?? 0), 0);

  const detailDefectQty = variants.reduce((total, item) => total + Number(item.defect_qty ?? 0), 0);

  const detailRejectQty = variants.reduce((total, item) => total + Number(item.reject_qty ?? 0), 0);

  const detailTotalQty = variants.reduce((total, item) => total + Number(item.total_qty ?? 0), 0);

  const detailNormalValueHpp = variants.reduce((total, item) => total + Number(item.normal_inventory_value_hpp ?? 0), 0);

  const detailDefectValueHpp = variants.reduce((total, item) => total + Number(item.defect_inventory_value_hpp ?? 0), 0);

  const detailRejectValueHpp = variants.reduce((total, item) => total + Number(item.reject_inventory_value_hpp ?? 0), 0);

  const detailTotalValueHpp = variants.reduce((total, item) => total + Number(item.total_inventory_value_hpp ?? 0), 0);

  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);



  const productImageUrl = productMaster?.image_path
    ? supabase.storage.from("product-images").getPublicUrl(productMaster.image_path).data.publicUrl
    : "";

  const variantMap = new Map<string, DetailVariant>();
  variants.forEach((variant) => variantMap.set(variant.variant_id, variant));

  const historyWithPrevious = priceHistory.map((row, index) => ({
    row,
    previous: priceHistory.slice(index + 1).find((item) => item.variant_id === row.variant_id) ?? null,
  }));



  function openImageZoom() {

    if (!productImageUrl) return;

    setImageZoom(1);

    setImagePan({ x: 0, y: 0 });

    setIsDraggingImage(false);

    setShowImageZoom(true);

  }



  function closeImageZoom() {

    setShowImageZoom(false);

    setImageZoom(1);

    setImagePan({ x: 0, y: 0 });

    setIsDraggingImage(false);

  }



  function changeImageZoom(delta: number) {

    setImageZoom((current) => {

      const next = Math.min(3, Math.max(1, Number((current + delta).toFixed(2))));

      if (next <= 1) setImagePan({ x: 0, y: 0 });

      return next;

    });

  }



  function startImageDrag(event: ReactPointerEvent<HTMLImageElement>) {

    if (imageZoom <= 1) return;

    event.preventDefault();

    event.stopPropagation();

    imageDragStart.current = {

      x: event.clientX,

      y: event.clientY,

      panX: imagePan.x,

      panY: imagePan.y,

    };

    setIsDraggingImage(true);

    event.currentTarget.setPointerCapture(event.pointerId);

  }



  function moveImageDrag(event: ReactPointerEvent<HTMLImageElement>) {

    if (!isDraggingImage || imageZoom <= 1) return;

    event.preventDefault();

    setImagePan({

      x: imageDragStart.current.panX + event.clientX - imageDragStart.current.x,

      y: imageDragStart.current.panY + event.clientY - imageDragStart.current.y,

    });

  }



  function endImageDrag(event?: ReactPointerEvent<HTMLImageElement>) {

    if (event) {

      event.preventDefault();

      event.stopPropagation();

    }

    setIsDraggingImage(false);

  }



  const updateUrl = (nextPage: number, nextSearch: string, nextProduct: string) => {

    const params = new URLSearchParams();

    if (nextSearch) params.set("q", nextSearch);

    if (nextPage > 1) params.set("page", String(nextPage));

    if (nextProduct) params.set("product", nextProduct);

    const query = params.toString();

    router.push(query ? `/products?${query}` : "/products");

  };



  function handleSearch(event: FormEvent<HTMLFormElement>) {

    event.preventDefault();

    const nextSearch = searchInput.trim();

    setSearch(nextSearch);

    setCurrentPage(1);

    setSelectedProductId("");

    updateUrl(1, nextSearch, "");

  }



  function handleReset() {

    setSearchInput("");

    setSearch("");

    setCurrentPage(1);

    setSelectedProductId("");

    updateUrl(1, "", "");

  }



  function handleViewProduct(productId: string) {

    setSelectedProductId(productId);

    updateUrl(currentPage, search, productId);

  }



  function handleCloseDetail() {

    setSelectedProductId("");

    updateUrl(currentPage, search, "");

  }



  function handlePageChange(page: number) {

    if (page < 1 || page > totalPages) return;

    setCurrentPage(page);

    setSelectedProductId("");

    updateUrl(page, search, "");

  }



  function openNewProduct() {

    setEditingProduct(null);

    setProductForm(EMPTY_PRODUCT_FORM);

    setProductImageFile(null);

    setProductImagePreview("");

    setErrorMessage("");

    setSuccessMessage("");

    setShowProductEditor(true);

  }



  function openEditProduct() {

    if (!productMaster) return;

    setEditingProduct(productMaster);

    setProductForm({

      product_code: productMaster.product_code,

      name: productMaster.name,

      brand: productMaster.brand ?? "Hi.PRIMA",

      category_id: productMaster.category_id ?? "",

      lifecycle_status: productMaster.lifecycle_status ?? "draft",

      is_active: productMaster.is_active,

    });

    setProductImageFile(null);

    setProductImagePreview(productImageUrl);

    setErrorMessage("");

    setSuccessMessage("");

    setShowProductEditor(true);

  }



  function handleProductImageChange(file: File | null) {

    setProductImageFile(file);

    if (file) setProductImagePreview(URL.createObjectURL(file));

    else setProductImagePreview(editingProduct?.image_path ? productImageUrl : "");

  }



  async function uploadProductImage(productId: string, file: File) {

    const blob = await compressImage(file);

    const path = `${productId}/${crypto.randomUUID()}.jpg`;

    const { error } = await supabase.storage.from("product-images").upload(path, blob, {

      contentType: "image/jpeg",

      upsert: false,

    });

    if (error) throw new Error(`Upload foto gagal: ${error.message}`);

    return path;

  }



  async function saveProduct(event: FormEvent<HTMLFormElement>) {

    event.preventDefault();

    if (!canManageMaster) return;



    const code = productForm.product_code.trim();

    const name = productForm.name.trim();

    const brand = productForm.brand.trim() || "Hi.PRIMA";

    const lifecycleStatus = productForm.lifecycle_status || "draft";

    const isActive = lifecycleStatus === "discontinued" ? false : productForm.is_active;



    if (!code || !name) {

      setErrorMessage("Kode produk dan nama produk wajib diisi.");

      return;

    }



    setSavingProduct(true);

    setErrorMessage("");

    setSuccessMessage("");



    try {

      let productId = editingProduct?.id ?? "";

      let oldImagePath = editingProduct?.image_path ?? null;



      if (editingProduct) {

        const { error } = await supabase

          .from("products")

          .update({

            product_code: code,

            name,

            brand,

            category_id: productForm.category_id || null,

            lifecycle_status: lifecycleStatus,

            is_active: isActive,

          })

          .eq("id", editingProduct.id);

        if (error) throw new Error(error.message);

      } else {

        const { data, error } = await supabase

          .from("products")

          .insert({

            product_code: code,

            name,

            brand,

            category_id: productForm.category_id || null,

            lifecycle_status: lifecycleStatus,

            is_active: isActive,

          })

          .select("id")

          .single();

        if (error || !data) throw new Error(error?.message ?? "Produk gagal dibuat.");

        productId = data.id;

      }



      if (productImageFile) {

        const newPath = await uploadProductImage(productId, productImageFile);

        const { error: imageUpdateError } = await supabase

          .from("products")

          .update({ image_path: newPath })

          .eq("id", productId);

        if (imageUpdateError) throw new Error(imageUpdateError.message);



        if (oldImagePath) {

          await supabase.storage.from("product-images").remove([oldImagePath]);

        }

      }



      setShowProductEditor(false);

      setProductImageFile(null);

      setSuccessMessage(editingProduct ? "Produk berhasil diperbarui." : "Produk berhasil dibuat.");

      setSelectedProductId(productId);

      updateUrl(currentPage, search, productId);

      await loadProducts();

    } catch (error) {

      setErrorMessage(error instanceof Error ? error.message : "Gagal menyimpan produk.");

    } finally {

      setSavingProduct(false);

    }

  }



  function openNewVariant() {

    if (!selectedProductId) return;

    setEditingVariant(null);

    setVariantForm(EMPTY_VARIANT_FORM);

    setErrorMessage("");

    setSuccessMessage("");

    setShowVariantEditor(true);

  }



  function openEditVariant(variant: DetailVariant) {

    setEditingVariant(variant);

    setVariantForm({

      sku: variant.sku,

      color: variant.color ?? "",

      size: variant.size ?? "",

      barcode: variant.barcode ?? "",

      hpp: String(variant.hpp || ""),

      selling_price: String(variant.selling_price || ""),

      lifecycle_status: variant.lifecycle_status ?? "draft",

      is_active: variant.is_active,

    });

    setErrorMessage("");

    setSuccessMessage("");

    setShowVariantEditor(true);

  }



  async function saveVariant(event: FormEvent<HTMLFormElement>) {

    event.preventDefault();

    if (!canManageMaster || !selectedProductId) return;



    const sku = variantForm.sku.trim();

    const color = variantForm.color.trim();

    const size = variantForm.size.trim();

    const hpp = Number(variantForm.hpp || 0);

    const sellingPrice = Number(variantForm.selling_price || 0);

    const lifecycleStatus = variantForm.lifecycle_status || "draft";

    const isActive = lifecycleStatus === "discontinued" ? false : variantForm.is_active;



    if (!sku || !color || !size) {

      setErrorMessage("SKU, warna, dan size wajib diisi.");

      return;

    }



    if (hpp < 0 || sellingPrice < 0) {

      setErrorMessage("HPP dan harga jual tidak boleh negatif.");

      return;

    }



    setSavingVariant(true);

    setErrorMessage("");

    setSuccessMessage("");



    try {

      // Barcode internal WMS dibuat otomatis dari SKU untuk variant baru.

      // Barcode existing tetap dipertahankan agar history dan referensi scan tidak berubah.

      const barcode = editingVariant?.barcode?.trim() || sku;



      const payload = {

        sku,

        color,

        size,

        barcode,

        hpp,

        selling_price: sellingPrice,

        cost_price: hpp,

        lifecycle_status: lifecycleStatus,

        is_active: isActive,

      };



      if (editingVariant) {

        const { error } = await supabase

          .from("product_variants")

          .update(payload)

          .eq("id", editingVariant.variant_id);

        if (error) throw new Error(error.message);

        setSuccessMessage("Variant berhasil diperbarui.");

      } else {

        const { error } = await supabase

          .from("product_variants")

          .insert({ product_id: selectedProductId, ...payload });

        if (error) throw new Error(error.message);

        setSuccessMessage("Variant berhasil ditambahkan.");

      }



      setShowVariantEditor(false);

      await loadProducts();

    } catch (error) {

      setErrorMessage(error instanceof Error ? error.message : "Gagal menyimpan variant.");

    } finally {

      setSavingVariant(false);

    }

  }



  return (

    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">

      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />



        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">

          <div className="mx-auto w-full min-w-0 max-w-[1600px]">

            <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

              <div className="min-w-0">

                <p className="text-sm text-slate-500">PT Prima Berkah Mulia</p>

                <h1 className="mt-1 text-3xl font-bold">Master Produk</h1>

                <p className="mt-2 text-sm text-slate-500">Master produk, SKU, lifecycle, harga, dan stok Hi.PRIMA.</p>

              </div>



              {canManageMaster && (

                <button

                  type="button"

                  onClick={openNewProduct}

                  className="shrink-0 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"

                >

                  + Tambah Produk

                </button>

              )}

            </header>



            {errorMessage && (

              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">

                {errorMessage}

              </div>

            )}



            {successMessage && (

              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">

                {successMessage}

              </div>

            )}



            {!loading && productMaster && selectedProduct && (

              <section className="mb-6 w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">

                  <div className="flex min-w-0 gap-4">

                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">

                      {productImageUrl ? (

                        <button

                          type="button"

                          onClick={openImageZoom}

                          className="group block h-full w-full cursor-zoom-in"

                          title="Klik untuk memperbesar foto"

                        >

                          <img

                            src={productImageUrl}

                            alt={productMaster.name}

                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"

                          />

                        </button>

                      ) : (

                        <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>

                      )}

                    </div>

                    <div className="min-w-0">

                      <div className="text-sm text-slate-500">Product Detail</div>

                      <h2 className="mt-1 break-words text-2xl font-bold">{productMaster.name}</h2>

                      <div className="mt-1 text-sm text-slate-500">

                        {productMaster.product_code} • {productMaster.brand ?? "-"}

                        {productMaster.is_active ? " • Active" : " • Inactive"}

                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">Lifecycle: {lifecycleLabel(productMaster.lifecycle_status)}</span>

                      </div>

                    </div>

                  </div>



                  <div className="flex shrink-0 flex-wrap gap-2">

                    {canManageMaster && (

                      <>

                        <button type="button" onClick={openEditProduct} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Edit Produk</button>

                        <button type="button" onClick={openNewVariant} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">+ Variant / SKU</button>

                      </>

                    )}

                    <button type="button" onClick={handleCloseDetail} className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Close</button>

                  </div>

                </div>



                <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                  {[

                    ["Normal", detailNormalQty],

                    ["Defect", detailDefectQty],

                    ["Reject", detailRejectQty],

                    ["Total Stock", detailTotalQty],

                  ].map(([label, value]) => (

                    <div key={String(label)} className="rounded-xl bg-slate-50 p-4">

                      <div className="text-sm text-slate-500">{label}</div>

                      <div className="mt-2 text-xl font-bold">{formatNumber(value as number)}</div>

                    </div>

                  ))}

                </div>



                <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                  <div className="rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-500">Nilai HPP Normal</div><div className="mt-2 text-lg font-bold">{formatRupiah(detailNormalValueHpp)}</div></div>

                  <div className="rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-500">Nilai HPP Defect</div><div className="mt-2 text-lg font-bold">{formatRupiah(detailDefectValueHpp)}</div></div>

                  <div className="rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-500">Nilai HPP Reject</div><div className="mt-2 text-lg font-bold">{formatRupiah(detailRejectValueHpp)}</div></div>

                  <div className="rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-500">Total Nilai HPP</div><div className="mt-2 text-lg font-bold">{formatRupiah(detailTotalValueHpp)}</div></div>

                </div>



                <div className="mb-6 rounded-2xl border border-slate-200 p-5">

                  <div className="mb-4">

                    <h3 className="font-semibold">Lifecycle & System Information</h3>

                    <p className="text-sm text-slate-500">Informasi lifecycle dan tanggal yang terbentuk dari aktivitas WMS.</p>

                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

                    <div><div className="text-xs text-slate-500">Lifecycle</div><div className="mt-1 text-sm font-semibold">{lifecycleLabel(productMaster.lifecycle_status)}</div></div>

                    <div><div className="text-xs text-slate-500">First Stock In</div><div className="mt-1 text-sm font-semibold">{formatDate(productMaster.first_stock_in_date)}</div></div>

                    <div><div className="text-xs text-slate-500">First Sale</div><div className="mt-1 text-sm font-semibold">{formatDate(productMaster.first_sale_date)}</div></div>

                    <div><div className="text-xs text-slate-500">Last Stock In</div><div className="mt-1 text-sm font-semibold">{formatDate(productMaster.last_stock_in_date)}</div></div>

                    <div><div className="text-xs text-slate-500">Last Sale</div><div className="mt-1 text-sm font-semibold">{formatDate(productMaster.last_sale_date)}</div></div>

                  </div>

                </div>



                <div className="mb-6 rounded-2xl border border-slate-200 p-5">
                  {(() => {
                    const actualChanges = historyWithPrevious.filter(
                      ({ row }) => row.change_type !== "baseline",
                    );
                    const baselineRecords = historyWithPrevious.filter(
                      ({ row }) => row.change_type === "baseline",
                    );

                    return (
                      <>
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="font-semibold">Riwayat Harga & HPP</h3>
                            <p className="text-sm text-slate-500">
                              Hanya perubahan harga/HPP yang ditampilkan. Baseline tetap tersimpan di sistem.
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                              {formatNumber(actualChanges.length)} perubahan
                            </div>
                            {baselineRecords.length > 0 && (
                              <details className="relative">
                                <summary className="cursor-pointer list-none rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                                  Lihat baseline ({formatNumber(baselineRecords.length)})
                                </summary>
                                <div className="absolute right-0 z-20 mt-2 w-[min(90vw,720px)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold">Baseline Harga & HPP</div>
                                      <div className="text-xs text-slate-500">Data awal saat history WMS diaktifkan.</div>
                                    </div>
                                  </div>
                                  <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                                    <table className="w-full min-w-[620px] text-left text-xs">
                                      <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                          <th className="px-3 py-2">SKU / Variant</th>
                                          <th className="px-3 py-2 text-right">HPP</th>
                                          <th className="px-3 py-2 text-right">Harga Jual</th>
                                          <th className="px-3 py-2">Tanggal</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {baselineRecords.map(({ row }) => {
                                          const variant = variantMap.get(row.variant_id);
                                          return (
                                            <tr key={row.id}>
                                              <td className="px-3 py-2">
                                                <div className="font-semibold">{variant?.sku ?? row.variant_id}</div>
                                                <div className="text-slate-500">
                                                  {variant ? `${variant.color ?? "-"} • Size ${variant.size ?? "-"}` : "Variant"}
                                                </div>
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-2 text-right">{formatRupiah(row.hpp)}</td>
                                              <td className="whitespace-nowrap px-3 py-2 text-right">{formatRupiah(row.selling_price)}</td>
                                              <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatDateTime(row.created_at)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </details>
                            )}
                          </div>
                        </div>

                        {priceHistoryError ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                            {priceHistoryError}
                          </div>
                        ) : actualChanges.length === 0 ? (
                          <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                            Belum ada perubahan harga/HPP untuk produk ini.
                          </div>
                        ) : (
                          <div className="w-full max-w-full overflow-x-auto rounded-xl border border-slate-200">
                            <table className="w-full min-w-[900px] text-left text-sm">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                  <th className="px-4 py-3">Tanggal</th>
                                  <th className="px-4 py-3">SKU / Variant</th>
                                  <th className="px-4 py-3 text-right">HPP</th>
                                  <th className="px-4 py-3 text-right">Harga Jual</th>
                                  <th className="px-4 py-3">Perubahan</th>
                                  <th className="px-4 py-3">Diubah oleh</th>
                                </tr>
                              </thead>

                              <tbody className="divide-y divide-slate-100">
                                {actualChanges.map(({ row, previous }) => {
                                  const variant = variantMap.get(row.variant_id);
                                  const change = priceChangeSummary(row, previous);

                                  return (
                                    <tr key={row.id} className="align-top hover:bg-slate-50">
                                      <td className="whitespace-nowrap px-4 py-3">
                                        <div className="font-medium">{formatDateTime(row.created_at)}</div>
                                        <div className="mt-1 text-xs text-slate-400">
                                          Efektif {formatDate(row.effective_from)}
                                        </div>
                                      </td>

                                      <td className="px-4 py-3">
                                        <div className="font-semibold">{variant?.sku ?? row.variant_id}</div>
                                        <div className="text-xs text-slate-500">
                                          {variant ? `${variant.color ?? "-"} • Size ${variant.size ?? "-"}` : "Variant"}
                                        </div>
                                      </td>

                                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                                        {formatRupiah(row.hpp)}
                                      </td>

                                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                                        {formatRupiah(row.selling_price)}
                                      </td>

                                      <td className="px-4 py-3">
                                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                          {change}
                                        </span>
                                        {row.change_reason && (
                                          <div className="mt-1 max-w-[280px] text-xs text-slate-500">
                                            {row.change_reason}
                                          </div>
                                        )}
                                      </td>

                                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                                        {userDisplayNames[row.changed_by ?? row.created_by ?? ""] ??
                                          shortUserId(row.changed_by ?? row.created_by)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div className="w-full max-w-full overflow-x-auto">

                  <table className="w-full min-w-[1400px] text-left text-sm">

                    <thead className="bg-slate-50 text-slate-500">

                      <tr>

                        <th className="px-4 py-3">SKU</th>

                        <th className="px-4 py-3">Variant</th>

                        <th className="px-4 py-3">Lifecycle</th>

                        <th className="px-4 py-3 text-right">HPP</th>

                        <th className="px-4 py-3 text-right">Harga Jual</th>

                        <th className="px-4 py-3 text-right">Margin</th>

                        <th className="px-4 py-3 text-right">Normal</th>

                        <th className="px-4 py-3 text-right">Defect</th>

                        <th className="px-4 py-3 text-right">Reject</th>

                        <th className="px-4 py-3 text-right">Total</th>

                        <th className="px-4 py-3">First Sale</th>

                        <th className="px-4 py-3">Last Sale</th>

                        <th className="px-4 py-3">Action</th>

                      </tr>

                    </thead>

                    <tbody className="divide-y divide-slate-100">

                      {variants.map((variant) => (

                        <tr key={variant.variant_id} className="align-top hover:bg-slate-50">

                          <td className="px-4 py-3 font-semibold">{variant.sku}</td>

                          <td className="px-4 py-3"><div>{variant.color ?? "-"}</div><div className="text-xs text-slate-400">Size: {variant.size ?? "-"}</div><div className="mt-1 text-xs text-slate-400">Barcode: {variant.barcode ?? "-"}</div></td>

                          <td className="px-4 py-3"><div className="font-medium">{lifecycleLabel(variant.lifecycle_status)}</div><div className="mt-1 text-xs text-slate-400">{variant.is_active ? "Active" : "Inactive"}</div></td>

                          <td className="whitespace-nowrap px-4 py-3 text-right">{formatRupiah(variant.hpp)}</td>

                          <td className="whitespace-nowrap px-4 py-3 text-right">{formatRupiah(variant.selling_price)}</td>

                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{formatPercent(variant.margin_pct)}</td>

                          <td className="px-4 py-3 text-right">{formatNumber(variant.normal_qty)}</td>

                          <td className="px-4 py-3 text-right">{formatNumber(variant.defect_qty)}</td>

                          <td className="px-4 py-3 text-right">{formatNumber(variant.reject_qty)}</td>

                          <td className="px-4 py-3 text-right font-bold">{formatNumber(variant.total_qty)}</td>

                          <td className="px-4 py-3">{formatDate(variant.first_sale_date)}</td>

                          <td className="px-4 py-3">{formatDate(variant.last_sale_date)}</td>

                          <td className="px-4 py-3"><div className="flex flex-col gap-2">{canManageMaster && <><button type="button" onClick={() => openEditVariant(variant)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium">Edit</button></>}</div></td>

                        </tr>

                      ))}

                      {variants.length === 0 && <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-400">Tidak ada variant.</td></tr>}

                    </tbody>

                  </table>

                </div>

              </section>

            )}



            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form onSubmit={handleSearch} className="flex w-full min-w-0 flex-col gap-3 lg:flex-row">

                <input name="q" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Cari kode produk, nama produk, atau brand..." className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500" />

                <button type="submit" className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800">Search</button>

                {search && <button type="button" onClick={handleReset} className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-sm hover:bg-slate-50">Reset</button>}

              </form>

            </section>



            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">

                <div><h2 className="text-lg font-semibold">Product List</h2><p className="text-sm text-slate-500">{formatNumber(totalCount)} produk ditemukan</p></div>

                <div className="shrink-0 text-sm text-slate-500">Page {currentPage} of {totalPages}</div>

              </div>



              <div className="w-full max-w-full overflow-x-auto">

                <table className="w-full min-w-[800px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-4">Product</th><th className="px-5 py-4">Brand</th><th className="px-5 py-4 text-right">Variants</th><th className="px-5 py-4 text-right">Stock</th><th className="px-5 py-4"></th></tr></thead>

                  <tbody className="divide-y divide-slate-100">

                    {products.map((product) => <tr key={product.product_id} className="hover:bg-slate-50"><td className="px-5 py-4"><div className="font-semibold">{product.product_name}</div><div className="text-xs text-slate-400">{product.product_code}</div></td><td className="px-5 py-4">{product.brand ?? "-"}</td><td className="px-5 py-4 text-right">{formatNumber(product.variant_count)}</td><td className="px-5 py-4 text-right font-semibold">{formatNumber(product.total_qty)}</td><td className="px-5 py-4 text-right"><button type="button" onClick={() => handleViewProduct(product.product_id)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50">View</button></td></tr>)}

                    {!loading && products.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">Tidak ada produk ditemukan.</td></tr>}

                  </tbody>

                </table>

              </div>



              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">

                <div className="text-sm text-slate-500">Menampilkan maksimal {pageSize} produk per halaman</div>

                <div className="flex shrink-0 gap-2"><button type="button" disabled={currentPage <= 1} onClick={() => handlePageChange(currentPage - 1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300">Previous</button><button type="button" disabled={currentPage >= totalPages} onClick={() => handlePageChange(currentPage + 1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300">Next</button></div>

              </div>

            </section>

          </div>

        </main>

      </div>



      {showProductEditor && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => !savingProduct && setShowProductEditor(false)}>

          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>

            <div className="mb-6 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{editingProduct ? "Edit Produk" : "Tambah Produk"}</h2><p className="mt-1 text-sm text-slate-500">Master produk induk. Variant/SKU dikelola setelah produk dibuat.</p></div><button type="button" onClick={() => setShowProductEditor(false)} className="text-slate-400 hover:text-slate-700">✕</button></div>

            <form onSubmit={saveProduct} className="space-y-5">

              <div className="grid gap-4 md:grid-cols-2">

                <label className="block"><span className="mb-2 block text-sm font-medium">Kode Produk *</span><input required value={productForm.product_code} onChange={(event) => setProductForm((current) => ({ ...current, product_code: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" /></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">Brand</span><select value={productForm.brand} onChange={(event) => setProductForm((current) => ({ ...current, brand: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="Hi.PRIMA">Hi.PRIMA</option><option value="PRIMAHIJAB">PRIMAHIJAB</option></select></label>

              </div>

              <label className="block"><span className="mb-2 block text-sm font-medium">Nama Produk *</span><input required value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" /></label>

              <div className="grid gap-4 md:grid-cols-2">

                <label className="block"><span className="mb-2 block text-sm font-medium">Kategori</span><select value={productForm.category_id} onChange={(event) => setProductForm((current) => ({ ...current, category_id: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="">Tanpa kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">Lifecycle Produk</span><select value={productForm.lifecycle_status} onChange={(event) => setProductForm((current) => { const lifecycle = event.target.value; return { ...current, lifecycle_status: lifecycle, is_active: lifecycle === "discontinued" ? false : current.is_active }; })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">{lifecycleOptionsForValue(productForm.lifecycle_status).map((option) => <option key={option} value={option}>{VARIANT_LIFECYCLE_OPTIONS.includes(option) ? lifecycleLabel(option) : `Legacy: ${lifecycleLabel(option)}`}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Draft = belum siap • Active = digunakan • Discontinued = dihentikan.</span></label>

              </div>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={productForm.is_active} onChange={(event) => setProductForm((current) => ({ ...current, is_active: event.target.checked }))} /><span><span className="block text-sm font-medium">Produk aktif</span><span className="block text-xs text-slate-500">Nonaktifkan tanpa menghapus history.</span></span></label>

              <div><span className="mb-2 block text-sm font-medium">Foto Produk</span><div className="grid gap-4 md:grid-cols-[160px_1fr]"><div className="h-40 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">{productImagePreview ? <img src={productImagePreview} alt="Preview" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>}</div><div className="flex flex-col justify-center gap-3"><input type="file" accept="image/*" onChange={(event) => handleProductImageChange(event.target.files?.[0] ?? null)} className="block w-full text-sm" /><p className="text-xs text-slate-500">Foto otomatis diperkecil maksimal ±1600 px dan dikompres sebelum disimpan ke Storage.</p></div></div></div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={savingProduct} onClick={() => setShowProductEditor(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium">Batal</button><button type="submit" disabled={savingProduct} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{savingProduct ? "Menyimpan..." : "Simpan Produk"}</button></div>

            </form>

          </div>

        </div>

      )}



      {showVariantEditor && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => !savingVariant && setShowVariantEditor(false)}>

          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>

            <div className="mb-6 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{editingVariant ? "Edit Variant / SKU" : "Tambah Variant / SKU"}</h2><p className="mt-1 text-sm text-slate-500">SKU existing tidak diganti saat edit untuk menjaga referensi history.</p></div><button type="button" onClick={() => setShowVariantEditor(false)} className="text-slate-400 hover:text-slate-700">✕</button></div>

            <form onSubmit={saveVariant} className="space-y-5">

              <div className="grid gap-4 md:grid-cols-2">

                <label className="block"><span className="mb-2 block text-sm font-medium">SKU *</span><input required disabled={Boolean(editingVariant)} value={variantForm.sku} onChange={(event) => setVariantForm((current) => ({ ...current, sku: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100" /></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">Barcode</span><input readOnly disabled value={editingVariant?.barcode?.trim() || variantForm.sku.trim() || "Akan dibuat otomatis"} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700 disabled:opacity-100" /><span className="mt-1 block text-xs text-slate-500">Otomatis mengikuti SKU. Untuk barcode internal WMS, nilai ini siap dipakai untuk barcode Code 128.</span></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">Warna *</span><input required value={variantForm.color} onChange={(event) => setVariantForm((current) => ({ ...current, color: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" /></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">Size *</span><input required value={variantForm.size} onChange={(event) => setVariantForm((current) => ({ ...current, size: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" /></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">HPP</span><input type="number" min="0" value={variantForm.hpp} onChange={(event) => setVariantForm((current) => ({ ...current, hpp: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" /></label>

                <label className="block"><span className="mb-2 block text-sm font-medium">Harga Jual</span><input type="number" min="0" value={variantForm.selling_price} onChange={(event) => setVariantForm((current) => ({ ...current, selling_price: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" /></label>

              </div>

              <div className="grid gap-4 md:grid-cols-2"><label className="block"><span className="mb-2 block text-sm font-medium">Lifecycle Variant</span><select value={variantForm.lifecycle_status} onChange={(event) => setVariantForm((current) => { const lifecycle = event.target.value; return { ...current, lifecycle_status: lifecycle, is_active: lifecycle === "discontinued" ? false : current.is_active }; })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">{lifecycleOptionsForValue(variantForm.lifecycle_status).map((option) => <option key={option} value={option}>{VARIANT_LIFECYCLE_OPTIONS.includes(option) ? lifecycleLabel(option) : `Legacy: ${lifecycleLabel(option)}`}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Draft = belum siap • Active = digunakan • Discontinued = dihentikan.</span></label><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={variantForm.is_active} onChange={(event) => setVariantForm((current) => ({ ...current, is_active: event.target.checked }))} /><span><span className="block text-sm font-medium">Variant aktif</span><span className="block text-xs text-slate-500">ON = boleh dipakai transaksi baru. OFF = tidak dipakai transaksi baru; history tetap ada.</span></span></label></div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={savingVariant} onClick={() => setShowVariantEditor(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium">Batal</button><button type="submit" disabled={savingVariant} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{savingVariant ? "Menyimpan..." : "Simpan Variant"}</button></div>

            </form>

          </div>

        </div>

      )}



      {showImageZoom && productImageUrl && (

        <div

          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-4"

          onPointerDown={(event) => {

            if (event.target === event.currentTarget) closeImageZoom();

          }}

          onWheel={(event) => {

            event.preventDefault();

            changeImageZoom(event.deltaY < 0 ? 0.2 : -0.2);

          }}

        >

          <div className="relative flex h-full w-full items-center justify-center overflow-hidden pointer-events-none">

            <img

              src={productImageUrl}

              alt={productMaster?.name ?? "Foto produk"}

              className={`pointer-events-auto max-h-[88vh] max-w-[92vw] select-none object-contain ${isDraggingImage ? "cursor-grabbing" : imageZoom > 1 ? "cursor-grab" : "cursor-default"} ${isDraggingImage ? "transition-none" : "transition-transform duration-150"}`}

              style={{

                transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`,

                touchAction: "none",

              }}

              draggable={false}

              onPointerDown={startImageDrag}

              onPointerMove={moveImageDrag}

              onPointerUp={endImageDrag}

              onPointerCancel={endImageDrag}

            />



            <div className="pointer-events-auto absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-white/95 p-2 shadow-xl">

              <button

                type="button"

                onClick={() => changeImageZoom(-0.2)}

                disabled={imageZoom <= 1}

                className="h-10 w-10 rounded-xl border border-slate-200 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-40"

                title="Zoom out"

              >

                −

              </button>

              <button

                type="button"

                onClick={() => setImageZoom(1)}

                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"

              >

                {Math.round(imageZoom * 100)}%

              </button>

              <button

                type="button"

                onClick={() => changeImageZoom(0.2)}

                disabled={imageZoom >= 3}

                className="h-10 w-10 rounded-xl border border-slate-200 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-40"

                title="Zoom in"

              >

                +

              </button>

              <button

                type="button"

                onClick={closeImageZoom}

                className="ml-1 h-10 w-10 rounded-xl bg-slate-900 text-white"

                title="Tutup"

              >

                ✕

              </button>

            </div>



            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-xs text-slate-600 shadow-lg">

              Klik di luar foto untuk menutup • Scroll untuk zoom • Drag foto saat zoom

            </div>

          </div>

        </div>

      )}





    </div>

  );

}
