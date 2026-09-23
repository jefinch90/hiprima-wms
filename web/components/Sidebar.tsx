"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const menuItems = [
  {
    label: "Dashboard",
    href: "/",
  },
  {
    label: "Products",
    href: "/products",
  },
  {
    label: "Inventory",
    href: "/inventory",
  },
  {
    label: "Stock Movement",
    href: "/stock-movement",
  },
  {
    label: "Locations",
    href: "/locations",
  },
  {
    label: "Users",
    href: "/users",
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] =
    useState(false);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  };

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      {/* =========================
          DESKTOP SIDEBAR
      ========================= */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-6 lg:block">
        <div className="mb-10">
          <div className="text-xl font-bold tracking-tight">
            Hi.PRIMA
          </div>

          <div className="text-sm text-slate-500">
            Warehouse Management System
          </div>
        </div>

        <nav className="space-y-2">
          {menuItems.map((item) => {
            const active = isActive(
              item.href
            );

            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "block rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
                    : "block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* =========================
          MOBILE MENU BUTTON
      ========================= */}
      <button
        type="button"
        onClick={() =>
          setMobileOpen(true)
        }
        aria-label="Buka menu"
        className="fixed bottom-5 left-5 z-40 flex h-14 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow-lg lg:hidden"
      >
        <span className="text-xl leading-none">
          ☰
        </span>

        <span>Menu</span>
      </button>

      {/* =========================
          MOBILE OVERLAY
      ========================= */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() =>
              setMobileOpen(false)
            }
            className="absolute inset-0 bg-slate-950/40"
          />

          {/* MOBILE DRAWER */}
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold tracking-tight">
                  Hi.PRIMA
                </div>

                <div className="mt-1 text-sm text-slate-500">
                  Warehouse Management System
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setMobileOpen(false)
                }
                aria-label="Tutup menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-xl text-slate-600"
              >
                ×
              </button>
            </div>

            <nav className="space-y-2">
              {menuItems.map((item) => {
                const active = isActive(
                  item.href
                );

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() =>
                      setMobileOpen(false)
                    }
                    className={
                      active
                        ? "block rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
                        : "block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-slate-200 pt-5 text-xs text-slate-400">
              PT Prima Berkah Mulia
            </div>
          </aside>
        </div>
      )}
    </>
  );
}