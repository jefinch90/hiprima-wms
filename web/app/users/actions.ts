"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function updateUserAction(
  formData: FormData
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const userId = String(
    formData.get("user_id") ?? ""
  );

  const fullName = String(
    formData.get("full_name") ?? ""
  ).trim();

  const role = String(
    formData.get("role") ?? ""
  ).trim();

  const isActive =
    String(
      formData.get("is_active") ?? ""
    ) === "true";

  const search = String(
    formData.get("search") ?? ""
  ).trim();

  const makeUrl = (
    type: "success" | "error",
    message: string
  ) => {
    const query = new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    query.set(type, message);

    return `/users?${query.toString()}`;
  };

  if (!userId) {
    redirect(
      makeUrl(
        "error",
        "User ID tidak ditemukan."
      )
    );
  }

  if (
    ![
      "owner",
      "admin",
      "warehouse_manager",
      "warehouse_staff",
      "viewer",
    ].includes(role)
  ) {
    redirect(
      makeUrl(
        "error",
        "Role tidak valid."
      )
    );
  }

  const { error } = await supabase.rpc(
    "update_wms_user",
    {
      p_user_id: userId,
      p_full_name:
        fullName || null,
      p_role: role,
      p_is_active: isActive,
    }
  );

  if (error) {
    redirect(
      makeUrl(
        "error",
        error.message
      )
    );
  }

  revalidatePath("/users");

  redirect(
    makeUrl(
      "success",
      "Data user berhasil diperbarui."
    )
  );
}