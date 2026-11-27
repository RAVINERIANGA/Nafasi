"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO_OTP, facilities, users } from "@/domain/demo-data";
import { HOME_PATH, ROLE_LABEL, SUBROLE_LABEL } from "@/domain/labels";
import { ApiClientError, api } from "@/services/api";
import { useApp, type Directory } from "@/services/provider";

type AuthSession = Directory & { token: string };

const ACCOUNTS = users.map((user) => ({
  ...user,
  facility: facilities.find((facility) => facility.id === user.facilityId)?.shortName ?? "Facility",
}));

export function SignIn() {
  const router = useRouter();
  const { ready, session, signIn } = useApp();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace(HOME_PATH[session.user.role]);
  }, [ready, session, router]);

  async function openSession(next: AuthSession) {
    if (!next.facility) throw new Error("This account has no facility.");
    signIn(next.token, next);
    router.push(HOME_PATH[next.user.role]);
  }

  async function enterAs(account: (typeof ACCOUNTS)[number]) {
    setBusy(true);
    setError("");
    try {
      const otp = await api<{ challengeId: string; simulatedCode: string; maskedTo: string }>("auth/otp", {
        body: { identifier: account.phone },
      });
      const verified = await api<{ pendingToken: string }>("auth/verify", {
        body: { challengeId: otp.challengeId, code: otp.simulatedCode },
      });
      const next = await api<AuthSession>("auth/pin", {
        body: { purpose: "login", pendingToken: verified.pendingToken, pin: account.pin },
      });
      await openSession(next);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The simulated sign-in did not complete.");
      setBusy(false);
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const otp = await api<{ challengeId: string; simulatedCode: string; maskedTo: string; note: string }>("auth/otp", {
        body: { identifier },
      });
      setChallengeId(otp.challengeId);
      setCode(otp.simulatedCode);
      setHint(`${otp.note} Code for ${otp.maskedTo}: ${otp.simulatedCode}`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not start the simulated code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const verified = await api<{ pendingToken: string }>("auth/verify", { body: { challengeId, code } });
      setPendingToken(verified.pendingToken);
      setHint("Code accepted. Enter the demo PIN for this account.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<AuthSession>("auth/pin", { body: { purpose: "login", pendingToken, pin } });
      await openSession(next);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not open the session.");
      setBusy(false);
    }
  }

  if (!ready || session) {
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the simulation…</p>;
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl gap-8 px-4 py-8 md:grid-cols-[1.1fr_0.9fr] md:px-8 md:py-12">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Simulated prototype</p>
        <h1 className="mt-3 font-display text-4xl text-teal-dark md:text-5xl">NAFASI</h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink/80">
          Emergency bed reservation for a fictional coast region. Clinics request a bed, hospitals accept or decline, and dispatch moves the patient. Nothing here is a live clinical system.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-ink/75">
          <li>Patients, phones, and registration numbers are invented.</li>
          <li>The one-time code is always {DEMO_OTP}. No SMS is sent.</li>
          <li>Choose a role below to see that side of the same referral.</li>
        </ul>
      </section>
      <section className="rounded-3xl border border-line bg-card p-5 shadow-card">
        <h2 className="font-display text-2xl text-teal-dark">Open a demo account</h2>
        <div className="mt-4 grid gap-2">
          {ACCOUNTS.map((account) => (
            <button
              key={account.id}
              type="button"
              disabled={busy}
              onClick={() => void enterAs(account)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3 py-3 text-left hover:border-teal disabled:opacity-60"
            >
              <span>
                <span className="block text-sm font-semibold">{account.name}</span>
                <span className="block text-xs text-ink/60">
                  {SUBROLE_LABEL[account.subrole]} · {account.facility}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-mist px-2 py-1 text-xs font-semibold text-teal-dark">{ROLE_LABEL[account.role]}</span>
            </button>
          ))}
        </div>
        <form
          className="mt-6 space-y-3 border-t border-line pt-5"
          onSubmit={pendingToken ? submitPin : challengeId ? verifyCode : requestCode}
        >
          <h3 className="text-sm font-semibold">Or sign in with a phone or email</h3>
          <label className="block text-xs font-semibold text-ink/70">
            Phone or email
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
              placeholder="+254711000221"
              autoComplete="username"
            />
          </label>
          {challengeId ? (
            <label className="block text-xs font-semibold text-ink/70">
              Simulated code
              <input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" inputMode="numeric" />
            </label>
          ) : null}
          {pendingToken ? (
            <label className="block text-xs font-semibold text-ink/70">
              PIN
              <input value={pin} onChange={(event) => setPin(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" inputMode="numeric" type="password" />
            </label>
          ) : null}
          {hint ? <p className="text-xs text-ink/70">{hint}</p> : null}
          {error ? <p className="text-sm text-clay">{error}</p> : null}
          <button type="submit" disabled={busy || !identifier.trim()} className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {pendingToken ? "Open session" : challengeId ? "Check code" : "Request simulated code"}
          </button>
        </form>
      </section>
    </main>
  );
}
