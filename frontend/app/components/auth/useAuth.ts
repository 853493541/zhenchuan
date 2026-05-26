"use client";

import { useEffect, useState } from "react";

export type AuthUser = {
  uid?: string;
  id?: string;
  username: string;
  displayName: string;
  isAdmin?: boolean;
  school?: string | null;
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUser(data?.user ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
