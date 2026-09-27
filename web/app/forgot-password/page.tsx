"use client";

import Link from "next/link";
import {
  FormEvent,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [email, setEmail] =
    useState("");
  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState("");
  const [success, setSuccess] =
    useState("");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanEmail =
      email.trim().toLowerCase();

    if (!cleanEmail) {
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    const basePath =
      process.env
        .NEXT_PUBLIC_BASE_PATH ??
      "";

    const redirectTo =
      `${window.location.origin}` +
      `${basePath}/reset-password/`;

    const { error } =
      await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        {
          redirectTo,
        }
      );

    if (error) {
      setError(
        "Email reset belum dapat dikirim. Silakan coba lagi."
      );
      setLoading(false);
      return;
    }

    setSuccess(
      "Jika email terdaftar di WMS, link reset password sudah dikirim. Silakan cek inbox dan folder spam."
    );

    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-medium text-slate-500">
            PT Prima Berkah Mulia
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Lupa Password
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Masukkan email akun WMS.
            Kami akan mengirimkan link
            untuk membuat password baru.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Email
            </label>

            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              placeholder="email@company.com"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-900"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60"
          >
            {loading
              ? "Mengirim..."
              : "Kirim Link Reset Password"}
          </button>

          <Link
            href="/login"
            className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Kembali ke Login
          </Link>
        </form>
      </div>
    </main>
  );
}
