"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";

type Profile = {
  full_name: string | null;
  role: string;
  is_active: boolean;
};

type NavigationLink = {
  label: string;
  href: string;
  visible: boolean;
  simulation?: boolean;
  exact?: boolean;
};

type NavigationGroup = {
  label: string;
  key: string;
  visible: boolean;
  children: NavigationLink[];
};

type NavigationItem = NavigationLink | NavigationGroup;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  warehouse_manager: "Warehouse Manager",
  warehouse_staff: "Warehouse Staff",
  viewer: "Viewer",
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const isProductionPlanningPath =
    pathname === "/production-planning" ||
    pathname.startsWith("/production-planning/");

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [mobileOpen, setMobileOpen] =
    useState(false);
  const [productionPlanningToggle, setProductionPlanningToggle] =
    useState<{ pathname: string; open: boolean } | null>(null);
  const productionPlanningOpen =
    productionPlanningToggle?.pathname === pathname
      ? productionPlanningToggle.open
      : isProductionPlanningPath;

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "full_name, role, is_active"
        )
        .eq("id", user.id)
        .single();

      if (!mounted) return;

      if (
        error ||
        !data ||
        data.is_active !== true
      ) {
        await supabase.auth.signOut();

        router.replace("/login");
        return;
      }

      setProfile(data as Profile);
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (!mobileOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const role = profile?.role ?? "";

  const canAccessProductionPlanning =
    role === "owner" ||
    role === "admin" ||
    role === "warehouse_manager";

  const navItems: NavigationItem[] = [
    {
      label: "Dashboard",
      href: "/",
      visible: true,
    },
    {
      label: "Products",
      href: "/products",
      visible: true,
    },
    {
      label: "Inventory",
      href: "/inventory",
      visible: true,
    },
    {
      label: "Stock Movement",
      href: "/stock-movement",
      visible: true,
    },
    {
      label: "Stock Opname",
      href: "/stock-opname",
      visible: true,
    },
    {
      label: "Sales Analytics",
      href: "/sales-analytics",
      visible:
        role === "owner" ||
        role === "admin",
    },
    {
      label: "Production Planning",
      key: "production-planning",
      visible: canAccessProductionPlanning,
      children: [
        {
          label: "Dashboard & Simulasi",
          href: "/production-planning/",
          visible: true,
          exact: true,
        },
        {
          label: "Review & Approval",
          href: "/production-planning/v4/review/",
          visible: true,
          simulation: true,
        },
        {
          label: "Production Orders",
          href: "/production-planning/orders/",
          visible: true,
        },
        {
          label: "Vendor Management",
          href: "/production-planning/vendors/",
          visible: true,
        },
      ],
    },
    {
      label: "Locations",
      href: "/locations",
      visible: true,
    },
    {
      label: "Users",
      href: "/users",
      visible:
        role === "owner" ||
        role === "admin",
    },
  ];

  function activeMenu(href: string, exact = false) {
    const currentPath = pathname.replace(/\/+$/, "") || "/";
    const targetPath = href.replace(/\/+$/, "") || "/";
    if (exact) return currentPath === targetPath;
    return currentPath === targetPath ||
      (targetPath !== "/" && currentPath.startsWith(`${targetPath}/`));
  }

  async function handleLogout() {
    setMobileOpen(false);

    await supabase.auth.signOut();

    router.replace("/login");
    router.refresh();
  }

  function renderMenuContent(instance: "desktop" | "mobile") {
    const planningSubmenuId = `production-planning-submenu-${instance}`;

    return (
      <>
        <div className="border-b border-slate-200 px-5 py-6">
          <div className="text-lg font-bold text-slate-900">
            Hi.PRIMA WMS
          </div>

          <div className="mt-1 text-xs text-slate-500">
            PT Prima Berkah Mulia
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-4">
          {navItems
            .filter(
              (item) => item.visible
            )
            .map((item) => {
              if ("children" in item) {
                const active = isProductionPlanningPath;

                return (
                  <div key={item.key} className="min-w-0">
                    <button
                      type="button"
                      aria-expanded={productionPlanningOpen}
                      aria-controls={planningSubmenuId}
                      onClick={() =>
                        setProductionPlanningToggle({
                          pathname,
                          open: !productionPlanningOpen,
                        })
                      }
                      className={
                        active
                          ? "flex w-full min-w-0 items-center justify-between gap-2 rounded-xl bg-slate-900 px-4 py-3 text-left text-sm font-semibold text-white"
                          : "flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }
                    >
                      <span className="min-w-0 break-words">
                        {item.label}
                      </span>
                      <span aria-hidden="true" className="shrink-0">
                        {productionPlanningOpen ? "−" : "+"}
                      </span>
                    </button>

                    {productionPlanningOpen && (
                      <div
                        id={planningSubmenuId}
                        className="ml-3 mt-1 min-w-0 space-y-1 border-l border-slate-200 pl-3"
                      >
                        {item.children.map((child) => {
                          const childActive = activeMenu(
                            child.href,
                            child.exact
                          );

                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              aria-current={
                                childActive ? "page" : undefined
                              }
                              onClick={() => setMobileOpen(false)}
                              className={
                                childActive
                                  ? "flex min-w-0 items-center justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-900 ring-1 ring-inset ring-indigo-200"
                                  : "flex min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }
                            >
                              <span className="min-w-0 break-words">
                                {child.label}
                              </span>
                              {child.simulation && (
                                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  Simulasi
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const active =
                activeMenu(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() =>
                    setMobileOpen(false)
                  }
                  className={
                    active
                      ? "block rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      : "block rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 rounded-xl bg-slate-50 p-3">
            <div className="truncate text-sm font-semibold text-slate-900">
              {profile?.full_name ||
                "WMS User"}
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {ROLE_LABELS[role] ||
                role ||
                "Loading..."}
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 self-start flex-col overflow-hidden border-r border-slate-200 bg-white lg:flex">
        {renderMenuContent("desktop")}
      </aside>

      <button
        type="button"
        aria-label="Open menu"
        onClick={() =>
          setMobileOpen(true)
        }
        className="fixed bottom-5 left-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-xl text-white shadow-lg lg:hidden"
      >
        ☰
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() =>
              setMobileOpen(false)
            }
            className="absolute inset-0 bg-black/40"
          />

          <aside className="relative z-10 flex h-dvh min-h-0 w-[min(82vw,300px)] flex-col overflow-hidden bg-white shadow-2xl">
            <div className="absolute right-3 top-3 z-20">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() =>
                  setMobileOpen(false)
                }
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-600"
              >
                ×
              </button>
            </div>

            {renderMenuContent("mobile")}
          </aside>
        </div>
      )}
    </>
  );
}
