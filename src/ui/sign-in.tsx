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
  
  // Custom signin fields
  const [tab, setTab] = useState<"quick" | "credential">("quick");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"credentials" | "otp" | "pin">("credentials");
  
  const [challengeId, setChallengeId] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeAccount, setActiveAccount] = useState<(typeof ACCOUNTS)[number] | null>(null);

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

  // Step 1: Identifier + Password check
  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    setError("");
    
    // Simulate secure enterprise password verification
    if (password.length > 0 && password.length < 4) {
      setError("Password must be at least 4 characters.");
      setBusy(false);
      return;
    }

    try {
      const otp = await api<{ challengeId: string; simulatedCode: string; maskedTo: string; note: string }>("auth/otp", {
        body: { identifier },
      });
      setChallengeId(otp.challengeId);
      setCode(otp.simulatedCode);
      setHint(`${otp.note} | Verified 2FA Code: ${otp.simulatedCode}`);
      setStep("otp");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "No account found matching those credentials.");
    } finally {
      setBusy(false);
    }
  }

  // Step 2: 2FA OTP verification
  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const verified = await api<{ pendingToken: string }>("auth/verify", {
        body: { challengeId, code },
      });
      setPendingToken(verified.pendingToken);
      setHint("2FA OTP verified. Confirm clinician authorization with your fast-entry security PIN.");
      setStep("pin");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Invalid verification code.");
    } finally {
      setBusy(false);
    }
  }

  // Step 3: PIN step-up
  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<AuthSession>("auth/pin", {
        body: { purpose: "login", pendingToken, pin },
      });
      await openSession(next);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Incorrect PIN for this credential.");
      setBusy(false);
    }
  }

  if (!ready || session) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-paper">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          <p className="text-sm font-medium text-ink/70">Connecting to NAFASI Dispatch Hub...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col justify-between selection:bg-teal selection:text-white">
      {/* Top Banner */}
      <header className="border-b border-line bg-paper/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-dark font-display text-lg font-bold text-white shadow-sm">
            N
          </span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-teal-dark">NAFASI</h1>
            <p className="text-[11px] font-medium tracking-wide text-ink/60 uppercase">Emergency Bed-Lock &amp; Pre-Arrival Dispatch</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-teal/20 bg-mist px-3 py-1 text-xs font-semibold text-teal-dark">
          <span className="h-2 w-2 rounded-full bg-moss animate-pulse" />
          Simulated Coast Network Active
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto my-auto w-full max-w-5xl px-4 py-8 md:py-12 grid gap-10 md:grid-cols-[1.1fr_0.9fr] items-center">
        {/* Left Hero */}
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-clay/30 bg-clay/5 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-clay">
            <span className="h-2 w-2 rounded-full bg-clay animate-pulse" />
            Zero Blind Referrals · 100% Traceability
          </div>
          
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl text-teal-dark leading-[1.1] font-semibold">
            Emergency care dispatch with guaranteed bed reservations.
          </h2>

          <p className="text-base sm:text-lg text-ink/75 leading-relaxed max-w-xl">
            Clinics request targeted emergency beds. Hospitals lock beds atomically within a 60-second window. Ambulance crews update live patient vitals en-route.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            <div className="rounded-2xl border border-line bg-card/60 p-3.5 shadow-sm">
              <p className="text-xs font-bold text-teal-dark uppercase tracking-wide">60s Window</p>
              <p className="text-xs text-ink/65 mt-0.5">Rapid triage with auto reroute on timeout</p>
            </div>
            <div className="rounded-2xl border border-line bg-card/60 p-3.5 shadow-sm">
              <p className="text-xs font-bold text-teal-dark uppercase tracking-wide">Atomic Lock</p>
              <p className="text-xs text-ink/65 mt-0.5">Zero dual allocation of emergency bays</p>
            </div>
            <div className="rounded-2xl border border-line bg-card/60 p-3.5 shadow-sm col-span-2 sm:col-span-1">
              <p className="text-xs font-bold text-teal-dark uppercase tracking-wide">Audit Trail</p>
              <p className="text-xs text-ink/65 mt-0.5">Every clinician decision stamped with ID & PIN</p>
            </div>
          </div>
        </section>

        {/* Right Authentication Card */}
        <section className="rounded-3xl border border-line bg-card p-6 shadow-card space-y-6">
          {/* Tabs */}
          <div className="flex rounded-2xl border border-line bg-paper p-1">
            <button
              type="button"
              onClick={() => { setTab("quick"); setError(""); }}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${
                tab === "quick" ? "bg-white text-teal-dark shadow-sm" : "text-ink/60 hover:text-ink"
              }`}
            >
              1-Tap Role Demo
            </button>
            <button
              type="button"
              onClick={() => { setTab("credential"); setError(""); setStep("credentials"); }}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${
                tab === "credential" ? "bg-white text-teal-dark shadow-sm" : "text-ink/60 hover:text-ink"
              }`}
            >
              Password &amp; PIN Login
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-clay/30 bg-clay/5 p-3.5 text-xs text-clay font-medium flex items-start gap-2">
              <span className="font-bold">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {hint && (
            <div className="rounded-2xl border border-teal/20 bg-mist p-3.5 text-xs text-teal-dark font-medium">
              {hint}
            </div>
          )}

          {/* Tab 1: Fast One-Click Demo Profiles */}
          {tab === "quick" && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-xl text-teal-dark font-semibold">Select a Role Profile</h3>
                <p className="text-xs text-ink/60 mt-0.5">Instant sign-in simulating verified clinician identity and facility credentials.</p>
              </div>

              <div className="grid gap-2 max-h-[360px] overflow-y-auto pr-1">
                {ACCOUNTS.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void enterAs(acc)}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3.5 text-left transition-all hover:border-teal hover:shadow-sm disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper font-display font-bold text-teal-dark group-hover:bg-teal group-hover:text-white transition-colors">
                        {acc.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-ink group-hover:text-teal-dark">{acc.name}</p>
                        <p className="text-xs text-ink/60">
                          {SUBROLE_LABEL[acc.subrole]} · <span className="font-medium text-ink/80">{acc.facility}</span>
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] font-bold text-ink/75 group-hover:border-teal group-hover:bg-mist group-hover:text-teal-dark">
                      {ROLE_LABEL[acc.role]} →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tab 2: Enterprise Password + 2FA + PIN Step-up */}
          {tab === "credential" && (
            <div>
              {step === "credentials" && (
                <form onSubmit={submitCredentials} className="space-y-4">
                  <div>
                    <h3 className="font-display text-xl text-teal-dark font-semibold">Sign In with Credentials</h3>
                    <p className="text-xs text-ink/60 mt-0.5">Enter your hospital phone/email and account password.</p>
                  </div>

                  <label className="block text-xs font-bold text-ink/75">
                    Phone number or Email
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="+254711000441 or grace.wanjiku@bahari.demo"
                      className="mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-teal"
                    />
                  </label>

                  <label className="block text-xs font-bold text-ink/75">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-teal"
                    />
                  </label>

                  <div className="rounded-xl bg-paper p-3 text-[11px] text-ink/60 space-y-1">
                    <p>💡 <strong>Demo Quick Fill:</strong></p>
                    <p>Doctor: <code className="bg-white px-1 py-0.5 rounded border border-line">+254711000441</code> (Bahari Hospital)</p>
                    <p>Clinic: <code className="bg-white px-1 py-0.5 rounded border border-line">+254711000221</code> (Rafiki Clinic)</p>
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !identifier.trim()}
                    className="w-full rounded-xl bg-teal py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-dark disabled:opacity-50"
                  >
                    {busy ? "Verifying..." : "Continue to 2FA Code →"}
                  </button>
                </form>
              )}

              {step === "otp" && (
                <form onSubmit={submitOtp} className="space-y-4">
                  <div>
                    <h3 className="font-display text-xl text-teal-dark font-semibold">Enter 2FA Code</h3>
                    <p className="text-xs text-ink/60 mt-0.5">A verification code has been dispatched to your verified phone.</p>
                  </div>

                  <label className="block text-xs font-bold text-ink/75">
                    One-Time Passcode (OTP)
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="482913"
                      className="mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-lg font-mono font-bold tracking-widest text-center text-teal-dark outline-none transition focus:border-teal"
                    />
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep("credentials")}
                      className="rounded-xl border border-line px-4 py-2.5 text-xs font-bold text-ink/70 hover:bg-paper"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy || !code.trim()}
                      className="flex-1 rounded-xl bg-teal py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-teal-dark disabled:opacity-50"
                    >
                      {busy ? "Checking..." : "Verify Code →"}
                    </button>
                  </div>
                </form>
              )}

              {step === "pin" && (
                <form onSubmit={submitPin} className="space-y-4">
                  <div>
                    <h3 className="font-display text-xl text-teal-dark font-semibold">Clinician Authorization PIN</h3>
                    <p className="text-xs text-ink/60 mt-0.5">Enter your 4-digit security PIN for session initialization.</p>
                  </div>

                  <label className="block text-xs font-bold text-ink/75">
                    Security PIN
                    <input
                      type="password"
                      required
                      maxLength={6}
                      inputMode="numeric"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="••••"
                      className="mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-xl font-mono font-bold tracking-widest text-center text-teal-dark outline-none transition focus:border-teal"
                    />
                  </label>

                  <div className="rounded-xl bg-paper p-3 text-[11px] text-ink/60">
                    ℹ️ Doctor PIN: <strong>3690</strong> | Clinic Nurse PIN: <strong>2580</strong> | Admin: <strong>0007</strong>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep("otp")}
                      className="rounded-xl border border-line px-4 py-2.5 text-xs font-bold text-ink/70 hover:bg-paper"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy || pin.length < 4}
                      className="flex-1 rounded-xl bg-moss py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-moss/90 disabled:opacity-50"
                    >
                      {busy ? "Opening..." : "Authorize & Sign In"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-paper/60 px-6 py-4 text-center text-xs text-ink/60">
        NAFASI Prototype · Simulated Patient Data Only · Compliant with Simulated Kenya Digital Health Architecture
      </footer>
    </div>
  );
}
