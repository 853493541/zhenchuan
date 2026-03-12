"use client";

import { useEffect, useState } from "react";

export function useAuth() {
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUser(data?.user?.username ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
