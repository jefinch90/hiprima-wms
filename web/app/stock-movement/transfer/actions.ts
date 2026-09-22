"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function transferStockAction(
  formData: FormData
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const variantId = String(
    formData.get("variant_id") ?? ""
  );

  const fromLocationId = String(
    formData.get("from_location_id") ?? ""
  );

  const toLocationId = String(
    formData.get("to_location_id") ?? ""
  );

  const sku = String(
    formData.get("sku") ?? ""
  );

  const quantity = Number(
    formData.get("quantity")
  );

  const referenceNo = String(
    formData.get("reference_no") ?? ""
  ).trim();

  const notes = String(
    formData.get("notes") ?? ""
  ).trim();

  const errorUrl = (message: string) => {
    const query = new URLSearchParams();

    if (sku) {
      query.set("q", sku);
    }

    if (variantId) {
      query.set("variant", variantId);
    }

    if (fromLocationId) {
      query.set("from", fromLocationId);
    }

    query.set("error", message);

    return `/stock-movement/transfer?${query.toString()}`;
  };

  if (
    !variantId ||
    !fromLocationId ||
    !toLocationId
  ) {
    redirect(
      errorUrl(
        "SKU, lokasi asal, dan lokasi tujuan wajib dipilih."
      )
    );
  }

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    redirect(
      errorUrl(
        "Quantity harus berupa angka lebih dari 0."
      )
    );
  }

  const { data, error } = await supabase.rpc(
    "transfer_stock",
    {
      p_variant_id: variantId,
      p_from_location_id: fromLocationId,
      p_to_location_id: toLocationId,
      p_quantity: quantity,
      p_reference_no:
        referenceNo || null,
      p_notes:
        notes || null,
    }
  );

  if (error) {
    redirect(
      errorUrl(error.message)
    );
  }

  const result = data?.[0];

  revalidatePath("/inventory");
  revalidatePath("/locations");
  revalidatePath("/products");
  revalidatePath("/stock-movement");
  revalidatePath(
    "/stock-movement/transfer"
  );

  const successQuery =
    new URLSearchParams();

  successQuery.set("success", "1");

  if (sku) {
    successQuery.set("sku", sku);
  }

  successQuery.set(
    "movement",
    String(
      result?.new_movement_no ?? ""
    )
  );

  successQuery.set(
    "source",
    String(
      result?.source_qty_after ?? ""
    )
  );

  successQuery.set(
    "destination",
    String(
      result?.destination_qty_after ?? ""
    )
  );

  redirect(
    `/stock-movement/transfer?${successQuery.toString()}`
  );
}