"use client";

import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [password, setPassword] =
    useState("");
  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [checking, setChecking] =
    useState(true);
  const [recoveryReady, setRecoveryReady] =
    useState(false);

  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState("");

  useEffect(() => {
    let mounted = true;

    const hashParams =
      new URLSearchParams(
        window.location.hash.replace(
          /^#/,
          ""
        )
      );

    const queryParams =
      new URLSearchParams(
        window.location.search
      );

    const urlError =
      hashParams.get(
        "error_description"
      ) ??
      queryParams.get(
        "error_description"
      );

    if (urlError) {
      setError(urlError);
    }

    async function checkSession() {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      if (session) {
        setRecoveryReady(true);
      }

      setChecking(false);
    }

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (event, session) => {
          if (!mounted) {
            return;
          }

          if (
            event ===
              "PASSWORD_RECOVERY" ||
            session
          ) {
            setRecoveryReady(true);
            setChecking(false);
          }
        }
      );

    checkSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleReset(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (password.length < 8) {
      setError(
        "Password baru minimal 8 karakter."
      );
      return;
    }

    if (
      password !==
      confirmPassword
    ) {
      setError(
        "Konfirmasi password tidak sama."
      );
      return;
    }

    setLoading(true);

    const { error } =
      await supabase.auth.updateUser({
        password,
      });

    if (error) {
      setError(
        error.message ||
          "Password gagal diperbarui."
      );
      setLoading(false);
      return;
    }

    window.alert(
      [
        "Password Berhasil Diubah",
        "",
        "Silakan login kembali menggunakan password baru.",
      ].join("\n")
    );

    await supabase.auth.signOut();

    router.replace("/login");
    router.refresh();
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-sm text-slate-500">
            Memeriksa link reset
            password...
          </div>
        </div>
      </main>
    );
  }

  if (!recoveryReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            PT Prima Berkah Mulia
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Link Tidak Valid
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-500">
            Link reset password
            tidak tersedia, sudah
            kedaluwarsa, atau sudah
            pernah digunakan.
          </p>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-3">
            <Link
              href="/forgot-password"
              className="block w-full rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white"
            >
              Kirim Link Baru
            </Link>

            <Link
              href="/login"
              className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-medium text-slate-700"
            >
              Kembali ke Login
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-medium text-slate-500">
            PT Prima Berkah Mulia
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Buat Password Baru
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Masukkan password baru
            untuk akun Hi.PRIMA WMS.
          </p>
        </div>

        <form
          onSubmit={handleReset}
          className="space-y-5"
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Password Baru
            </label>

            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
              placeholder="Minimal 8 karakter"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Konfirmasi Password
            </label>

            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={
                confirmPassword
              }
              onChange={(event) =>
                setConfirmPassword(
                  event.target.value
                )
              }
              placeholder="Ulangi password baru"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-900"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60"
          >
            {loading
              ? "Menyimpan..."
              : "Simpan Password Baru"}
          </button>
        </form>
      </div>
    </main>
  );
}
