"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ConnectivityMode, Facility, PublicUser, SystemConfig } from "@/domain/types";
import { api, setApiSession } from "@/services/api";
import { ensureSampleQueue } from "@/services/offline";

export type Directory = {
  user: PublicUser;
  facility?: Facility;
  facilities: Facility[];
  config: SystemConfig;
  users?: PublicUser[];
};

export type SessionBundle = Directory & { token: string; facility: Facility };

type AppContextValue = {
  ready: boolean;
  session: SessionBundle | null;
  connectivity: ConnectivityMode;
  signIn: (token: string, directory: Directory) => void;
  signOut: () => Promise<void>;
  setConnectivity: (mode: ConnectivityMode) => void;
};

const MODES: ConnectivityMode[] = ["online", "degraded", "gateway_failure", "offline"];
const AppContext = createContext<AppContextValue | null>(null);

function readMode(): ConnectivityMode {
  const stored = localStorage.getItem("nafasi-connectivity");
  return MODES.includes(stored as ConnectivityMode) ? (stored as ConnectivityMode) : "online";
}

export function Provider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionBundle | null>(null);
  const [connectivity, setMode] = useState<ConnectivityMode>("online");

  const apply = useCallback((token: string, mode: ConnectivityMode) => {
    setApiSession(token, mode);
  }, []);

  useEffect(() => {
    const mode = readMode();
    const token = localStorage.getItem("nafasi-token") ?? "";
    setMode(mode);
    apply(token, mode);
    void ensureSampleQueue();
    if (!token) {
      setReady(true);
      return;
    }
    api<Directory>("session")
      .then((directory) => {
        if (!directory.facility) throw new Error("Facility missing from session.");
        setSession({ token, ...directory, facility: directory.facility });
      })
      .catch(() => {
        localStorage.removeItem("nafasi-token");
        apply("", mode);
      })
      .finally(() => setReady(true));
  }, [apply]);

  const signIn = useCallback(
    (token: string, directory: Directory) => {
      if (!directory.facility) return;
      localStorage.setItem("nafasi-token", token);
      apply(token, connectivity);
      setSession({ token, ...directory, facility: directory.facility });
    },
    [apply, connectivity],
  );

  const signOut = useCallback(async () => {
    try {
      await api("session/logout", { method: "POST", body: {} });
    } catch {
      /* The simulated session may already be gone. */
    }
    localStorage.removeItem("nafasi-token");
    apply("", connectivity);
    setSession(null);
  }, [apply, connectivity]);

  const setConnectivity = useCallback(
    (mode: ConnectivityMode) => {
      localStorage.setItem("nafasi-connectivity", mode);
      setMode(mode);
      apply(session?.token ?? "", mode);
    },
    [apply, session?.token],
  );

  const value = useMemo(
    () => ({ ready, session, connectivity, signIn, signOut, setConnectivity }),
    [ready, session, connectivity, signIn, signOut, setConnectivity],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside Provider");
  return value;
}
