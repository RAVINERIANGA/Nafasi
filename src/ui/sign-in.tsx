"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HOME_PATH, ROLE_LABEL, SUBROLE_LABEL } from "@/domain/labels";
import type { Facility, Role, Subrole } from "@/domain/types";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp, type Directory } from "@/services/provider";

type AuthSession = Directory & { token: string };
type AuthMode = "signin" | "create";
type SelfRegisterRole = Exclude<Role, "admin">;

interface PendingRegistration {
  id: string;
  name: string;
  contact: string;
  role: SelfRegisterRole;
  subrole: Subrole;
  facilityId: string;
  facilityName: string;
  registrationNumber?: string;
  submittedAt: string;
  status: "pending_facility_approval";
}

const PENDING_STORAGE_KEY = "nafasi-pending-registrations";

const SELF_ROLES: SelfRegisterRole[] = ["clinic", "hospital", "transport"];

const ROLE_SUBROLES: Record<SelfRegisterRole, Subrole[]> = {
  clinic: ["nurse", "clinical_officer", "doctor"],
  hospital: ["doctor", "triage_officer", "hospital_admin"],
  transport: ["emt", "driver", "dispatcher"],
};

function requiresRegistrationNumber(role: SelfRegisterRole, subrole: Subrole) {
  if (role === "clinic") return true;
  if (role === "hospital") return subrole === "doctor" || subrole === "triage_officer";
  return subrole === "emt";
}

function readPendingRegistrations(): PendingRegistration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingRegistration[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingRegistration(entry: PendingRegistration) {
  if (typeof window === "undefined") return;
  try {
    const existing = readPendingRegistrations().filter(
      (item) => item.contact.trim().toLowerCase() !== entry.contact.trim().toLowerCase(),
    );
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify([entry, ...existing].slice(0, 10)));
  } catch {
    /* ignore storage quota errors */
  }
}

function isValidContact(value: string) {
  const trimmed = value.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  const isPhone = digits.length >= 9 && digits.length <= 15 && /^[+\d\s()-]+$/.test(trimmed);
  return isEmail || isPhone;
}

export function SignIn() {
  const router = useRouter();
  const { ready, session, connectivity, setConnectivity, signIn } = useApp();

  const [mode, setMode] = useState<AuthMode>("signin");

  // Sign-in state
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [maskedTo, setMaskedTo] = useState("");
  const [signInNotice, setSignInNotice] = useState("");
  const [signInError, setSignInError] = useState("");
  const [busy, setBusy] = useState(false);

  // Create-account state
  const [fullName, setFullName] = useState("");
  const [contact, setContact] = useState("");
  const [regRole, setRegRole] = useState<SelfRegisterRole>("clinic");
  const [regSubrole, setRegSubrole] = useState<Subrole>("nurse");
  const [regFacilityId, setRegFacilityId] = useState<string>("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [createError, setCreateError] = useState("");
  const [submittedRequest, setSubmittedRequest] = useState<PendingRegistration | null>(null);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const facilitiesLoaded = useRef(false);

  const identifierRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && session) {
      router.replace(HOME_PATH[session.user.role]);
    }
  }, [ready, session, router]);

  // Lazily load facility data only when Create Account tab is opened
  async function loadFacilities() {
    if (facilitiesLoaded.current) return;
    facilitiesLoaded.current = true;
    const { facilities } = await import("@/domain/demo-data");
    setAllFacilities(facilities);
    const first = facilities.find((f) => f.type === "clinic" && f.participating);
    if (first) setRegFacilityId(first.id);
  }

  const roleFacilities = useMemo(() => {
    const targetType = regRole === "transport" ? "dispatch" : regRole;
    return allFacilities.filter((f) => f.type === targetType);
  }, [regRole, allFacilities]);

  const needsLicense = requiresRegistrationNumber(regRole, regSubrole);
  const signInStep = pendingToken ? 3 : challengeId ? 2 : 1;

  function switchMode(next: AuthMode) {
    setMode(next);
    setSignInError("");
    setCreateError("");
    if (next === "create") void loadFacilities();
  }

  function resetSignIn() {
    setChallengeId("");
    setPendingToken("");
    setCode("");
    setPin("");
    setMaskedTo("");
    setSignInNotice("");
    setSignInError("");
    setTimeout(() => identifierRef.current?.focus(), 0);
  }

  function handleRoleChange(nextRole: SelfRegisterRole) {
    setRegRole(nextRole);
    const nextSubrole = ROLE_SUBROLES[nextRole][0];
    setRegSubrole(nextSubrole);
    const targetType = nextRole === "transport" ? "dispatch" : nextRole;
    const firstFacility = allFacilities.find((f) => f.type === targetType);
    setRegFacilityId(firstFacility?.id ?? "");
    if (!requiresRegistrationNumber(nextRole, nextSubrole)) {
      setCreateError("");
    }
  }

  async function openSession(next: AuthSession) {
    if (!next.facility) {
      throw new Error("This account has no assigned facility.");
    }
    signIn(next.token, next);
    router.push(HOME_PATH[next.user.role]);
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = identifier.trim();
    if (!trimmed) {
      setSignInError("Enter your registered phone number or email.");
      identifierRef.current?.focus();
      return;
    }

    setBusy(true);
    setSignInError("");
    setSignInNotice("");
    try {
      const otp = await api<{
        challengeId: string;
        maskedTo: string;
        note: string;
      }>("auth/otp", {
        body: { identifier: trimmed },
      });
      setChallengeId(otp.challengeId);
      setMaskedTo(otp.maskedTo);
      setCode("482913"); // Auto-fill the verified demo OTP so the user never gets a mismatch
      setSignInNotice(`${otp.note} Code 482913 generated for ${otp.maskedTo}.`);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setSignInError("Link is set to Offline. Switch to Online to sign in.");
      } else if (caught instanceof ApiClientError && caught.code === "UNKNOWN_ACCOUNT") {
        const pendingMatch = readPendingRegistrations().find(
          (item) => item.contact.replace(/\s/g, "").toLowerCase() === trimmed.replace(/\s/g, "").toLowerCase(),
        );
        if (pendingMatch) {
          setSignInError(
            "This account request is pending facility approval. Access stays locked until an administrator approves it.",
          );
        } else {
          setSignInError(caught.message);
        }
      } else {
        setSignInError(
          caught instanceof ApiClientError
            ? caught.message
            : "Could not start verification. Check your phone or email.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setSignInError("Enter your verification code.");
      codeRef.current?.focus();
      return;
    }

    setBusy(true);
    setSignInError("");
    try {
      const verified = await api<{ pendingToken: string; note: string }>("auth/verify", {
        body: { challengeId, code: trimmedCode },
      });
      setPendingToken(verified.pendingToken);
      setPin("");
      setSignInNotice(verified.note);
      setTimeout(() => pinRef.current?.focus(), 0);
    } catch (caught) {
      setSignInError(
        caught instanceof ApiClientError ? caught.message : "Could not verify that code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(event: React.FormEvent) {
    event.preventDefault();
    if (pin.length < 4) {
      setSignInError("Enter your 4-digit PIN.");
      pinRef.current?.focus();
      return;
    }

    setBusy(true);
    setSignInError("");
    try {
      const next = await api<AuthSession>("auth/pin", {
        body: { purpose: "login", pendingToken, pin },
      });
      await openSession(next);
    } catch (caught) {
      setSignInError(
        caught instanceof ApiClientError ? caught.message : "Could not sign in with that PIN.",
      );
      setBusy(false);
    }
  }

  function submitRegistration(event: React.FormEvent) {
    event.preventDefault();
    setCreateError("");

    const trimmedName = fullName.trim();
    const trimmedContact = contact.trim();
    const trimmedReg = registrationNumber.trim();
    const facility = roleFacilities.find((f) => f.id === regFacilityId);

    if (trimmedName.length < 2) {
      setCreateError("Enter your full name.");
      return;
    }
    if (!isValidContact(trimmedContact)) {
      setCreateError("Enter a valid phone number or email address.");
      return;
    }
    if (!facility) {
      setCreateError("Select a facility.");
      return;
    }
    if (needsLicense && trimmedReg.length < 3) {
      setCreateError("Enter your professional registration number for this role.");
      return;
    }

    const entry: PendingRegistration = {
      id: `req_${crypto.randomUUID().slice(0, 8)}`,
      name: trimmedName,
      contact: trimmedContact,
      role: regRole,
      subrole: regSubrole,
      facilityId: facility.id,
      facilityName: facility.name,
      registrationNumber: trimmedReg || undefined,
      submittedAt: new Date().toISOString(),
      status: "pending_facility_approval",
    };

    savePendingRegistration(entry);
    setSubmittedRequest(entry);
    setFullName("");
    setContact("");
    setRegistrationNumber("");
  }

  if (!ready || session) {
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the simulation…</p>;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <p className="bg-teal-dark px-4 py-2 text-center text-xs text-white/95">
        Simulated prototype. Fictional data only.
      </p>

      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-8 sm:px-8 md:grid-cols-[1.05fr_0.95fr] md:gap-12 md:py-12">
        {/* Concise hero */}
        <section className="space-y-5">
          <p className="font-display text-2xl tracking-tight text-teal-dark">NAFASI</p>
          <h1 className="font-display text-4xl leading-[1.1] text-teal-dark sm:text-5xl">
            Beds ready before arrival.
          </h1>
          <p className="max-w-md text-base leading-relaxed text-ink/80 sm:text-lg">
            Connect clinics, hospitals, and transport teams.
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">
            Referrals · Bed reservations · Dispatch
          </p>
        </section>

        {/* Single compact authentication card */}
        <section
          aria-label="Authentication"
          className="rounded-3xl border border-line bg-card p-6 shadow-card sm:p-7"
        >
          <div className="grid grid-cols-2 gap-1.5 rounded-full border border-line bg-paper p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              onClick={() => switchMode("signin")}
              className={`min-h-[42px] rounded-full px-4 text-sm font-semibold transition ${
                mode === "signin" ? "bg-teal text-white" : "text-ink/75 hover:text-ink"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "create"}
              onClick={() => switchMode("create")}
              className={`min-h-[42px] rounded-full px-4 text-sm font-semibold transition ${
                mode === "create" ? "bg-teal text-white" : "text-ink/75 hover:text-ink"
              }`}
            >
              Create account
            </button>
          </div>

          {mode === "signin" ? (
            <div className="mt-5">
              <p className="text-xs text-ink/70">Simulated auth. No real SMS or email is sent.</p>

              {connectivity === "offline" ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber/35 bg-amber/10 px-3.5 py-2.5 text-xs text-ink">
                  <span>Simulated link is set to Offline.</span>
                  <button
                    type="button"
                    onClick={() => setConnectivity("online")}
                    className="rounded-full border border-amber/40 bg-white px-3 py-1 font-semibold text-ink hover:border-teal"
                  >
                    Switch to Online
                  </button>
                </div>
              ) : null}

              <form
                className="mt-4 space-y-4"
                onSubmit={
                  signInStep === 3 ? submitPin : signInStep === 2 ? verifyCode : requestCode
                }
                noValidate
              >
                {signInStep === 1 ? (
                  <div>
                    <label htmlFor="auth-identifier" className="block text-xs font-semibold text-ink/80">
                      Phone or email
                    </label>
                    <input
                      ref={identifierRef}
                      id="auth-identifier"
                      type="text"
                      value={identifier}
                      onChange={(event) => {
                        setIdentifier(event.target.value);
                        if (signInError) setSignInError("");
                      }}
                      autoComplete="username"
                      className="mt-1.5 min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm text-ink"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper/70 px-3.5 py-2 text-xs">
                    <span className="font-semibold text-ink">{maskedTo || identifier.trim()}</span>
                    <button
                      type="button"
                      onClick={resetSignIn}
                      className="min-h-[34px] rounded-full border border-line bg-white px-3 py-1 font-semibold text-teal-dark hover:border-teal"
                    >
                      Change
                    </button>
                  </div>
                )}

                {signInStep === 2 ? (
                  <div>
                    <label htmlFor="auth-code" className="block text-xs font-semibold text-ink/80">
                      Verification code
                    </label>
                    <input
                      ref={codeRef}
                      id="auth-code"
                      type="text"
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
                        if (signInError) setSignInError("");
                      }}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="mt-1.5 min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 py-2 font-mono text-base tracking-widest text-ink"
                    />
                  </div>
                ) : null}

                {signInStep === 3 ? (
                  <div>
                    <label htmlFor="auth-pin" className="block text-xs font-semibold text-ink/80">
                      PIN
                    </label>
                    <input
                      ref={pinRef}
                      id="auth-pin"
                      type="password"
                      value={pin}
                      onChange={(event) => {
                        setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                        if (signInError) setSignInError("");
                      }}
                      inputMode="numeric"
                      autoComplete="current-password"
                      className="mt-1.5 min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 py-2 font-mono text-base tracking-widest text-ink"
                    />
                  </div>
                ) : null}

                {signInNotice ? (
                  <p
                    role="status"
                    className="rounded-2xl border border-teal/25 bg-mist/70 px-3.5 py-2.5 text-xs text-teal-dark"
                  >
                    {signInNotice}
                  </p>
                ) : null}

                {signInError ? (
                  <p
                    role="alert"
                    className="rounded-2xl border border-clay/30 bg-clay/10 px-3.5 py-2.5 text-sm font-medium text-clay"
                  >
                    {signInError}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[48px] flex-1 rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-dark disabled:opacity-55"
                  >
                    {busy
                      ? "Checking…"
                      : signInStep === 3
                        ? "Sign in"
                        : signInStep === 2
                          ? "Verify code"
                          : "Continue"}
                  </button>
                  {signInStep === 2 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(event) => void requestCode(event)}
                      className="min-h-[48px] rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-ink hover:border-teal disabled:opacity-55"
                    >
                      New code
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          ) : submittedRequest ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-amber/35 bg-amber/10 p-4 space-y-2">
                <span className="inline-flex rounded-full bg-amber px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  Pending facility approval
                </span>
                <h2 className="font-display text-2xl text-teal-dark">Request recorded</h2>
                <p className="text-xs leading-relaxed text-ink/80">
                  Your account request for <span className="font-semibold">{submittedRequest.facilityName}</span> is awaiting facility approval in this simulation. No real SMS or email was sent, and referral data remains locked until approved.
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-2.5 rounded-2xl border border-line bg-paper/70 p-3.5 text-xs">
                <div>
                  <dt className="text-ink/55">Name</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{submittedRequest.name}</dd>
                </div>
                <div>
                  <dt className="text-ink/55">Role</dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {ROLE_LABEL[submittedRequest.role]} · {SUBROLE_LABEL[submittedRequest.subrole]}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/55">Contact</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{submittedRequest.contact}</dd>
                </div>
                <div>
                  <dt className="text-ink/55">Registration</dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {submittedRequest.registrationNumber || "Not required"}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="min-h-[46px] flex-1 rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark"
                >
                  Back to Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setSubmittedRequest(null)}
                  className="min-h-[46px] rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-ink"
                >
                  New request
                </button>
              </div>
            </div>
          ) : (
            <form className="mt-5 space-y-3.5" onSubmit={submitRegistration} noValidate>
              <p className="text-xs text-ink/70">Requests require facility approval before access.</p>

              <div>
                <label htmlFor="reg-name" className="block text-xs font-semibold text-ink/80">
                  Full name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    if (createError) setCreateError("");
                  }}
                  autoComplete="name"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm text-ink"
                />
              </div>

              <div>
                <label htmlFor="reg-contact" className="block text-xs font-semibold text-ink/80">
                  Phone or email
                </label>
                <input
                  id="reg-contact"
                  type="text"
                  value={contact}
                  onChange={(event) => {
                    setContact(event.target.value);
                    if (createError) setCreateError("");
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm text-ink"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-role" className="block text-xs font-semibold text-ink/80">
                    Role
                  </label>
                  <select
                    id="reg-role"
                    value={regRole}
                    onChange={(event) => handleRoleChange(event.target.value as SelfRegisterRole)}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                  >
                    {SELF_ROLES.map((item) => (
                      <option key={item} value={item}>
                        {ROLE_LABEL[item]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-subrole" className="block text-xs font-semibold text-ink/80">
                    Position
                  </label>
                  <select
                    id="reg-subrole"
                    value={regSubrole}
                    onChange={(event) => setRegSubrole(event.target.value as Subrole)}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                  >
                    {ROLE_SUBROLES[regRole].map((item) => (
                      <option key={item} value={item}>
                        {SUBROLE_LABEL[item]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="reg-facility" className="block text-xs font-semibold text-ink/80">
                  Facility
                </label>
                <select
                  id="reg-facility"
                  value={regFacilityId}
                  onChange={(event) => setRegFacilityId(event.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                >
                  {roleFacilities.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="reg-license" className="block text-xs font-semibold text-ink/80">
                  Professional registration number {needsLicense ? "" : "(optional)"}
                </label>
                <input
                  id="reg-license"
                  type="text"
                  value={registrationNumber}
                  onChange={(event) => {
                    setRegistrationNumber(event.target.value);
                    if (createError) setCreateError("");
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm text-ink"
                />
              </div>

              {createError ? (
                <p
                  role="alert"
                  className="rounded-2xl border border-clay/30 bg-clay/10 px-3.5 py-2.5 text-sm font-medium text-clay"
                >
                  {createError}
                </p>
              ) : null}

              <button
                type="submit"
                className="min-h-[48px] w-full rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-dark"
              >
                Request account
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
