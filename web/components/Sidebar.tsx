"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
];

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  };

  return (
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
          const active = isActive(item.href);

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

        {/* USERS - BELUM DIAKTIFKAN */}
        <div className="rounded-xl px-4 py-3 text-sm text-slate-400">
          Users
        </div>
      </nav>
    </aside>
  );
}