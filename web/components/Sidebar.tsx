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

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      {/* =====================================================
          DESKTOP SIDEBAR
      ====================================================== */}

      <aside className="hidden w-[272px] shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col overflow-y-auto">
          <div className="px-6 pb-8 pt-8">
            <div className="text-xl font-bold text-slate-900">
              Hi.PRIMA
            </div>

            <div className="mt-1 text-sm leading-5 text-slate-500">
              Warehouse Management
              <br />
              System
            </div>
          </div>

          <nav className="flex-1 px-6">
            <div className="space-y-2">
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
                        : "block rounded-xl px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="px-6 pb-7 pt-8">
            <div className="border-t border-slate-200 pt-5">
              <div className="text-xs text-slate-400">
                PT Prima Berkah Mulia
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* =====================================================
          MOBILE MENU BUTTON
          Compact supaya tidak menutupi tombol form
      ====================================================== */}

      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={() =>
          setMobileOpen(true)
        }
        className="fixed bottom-5 left-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-2xl font-medium text-white shadow-lg lg:hidden"
      >
        ☰
      </button>

      {/* =====================================================
          MOBILE DRAWER
      ====================================================== */}

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Overlay */}
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() =>
              setMobileOpen(false)
            }
            className="absolute inset-0 bg-slate-950/40"
          />

          {/* Drawer */}
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-[320px] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-6">
              <div>
                <div className="text-xl font-bold text-slate-900">
                  Hi.PRIMA
                </div>

                <div className="mt-1 text-sm leading-5 text-slate-500">
                  Warehouse Management
                  <br />
                  System
                </div>
              </div>

              <button
                type="button"
                aria-label="Close menu"
                onClick={() =>
                  setMobileOpen(false)
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-2xl leading-none text-slate-600"
              >
                ×
              </button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-2">
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
                          : "block rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </nav>

            <div className="border-t border-slate-200 px-6 py-5">
              <div className="text-xs text-slate-400">
                PT Prima Berkah Mulia
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}