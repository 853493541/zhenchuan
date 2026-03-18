"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  // ✅ guarantees ONE /me call per page load
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        // 🧪 First test CORS with a public endpoint
        console.log("🧪 AuthGate: Testing CORS at /api/test-cors");
        
        const testRes = await fetch("/api/test-cors", {
          method: "GET",
          headers: {
            "Accept": "application/json",
          }
        }).catch(err => {
          console.error("❌ CORS Test Failed:", err.message);
          throw err;
        });
        console.log("✅ CORS Test passed, status:", testRes.status);

        // ✅ Now check auth
        console.log("🔐 AuthGate: Checking auth at /api/auth/me");
        
        const res = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
          headers: {
            "Accept": "application/json",
          }
        });

        console.log("📡 AuthGate: Response status =", res.status);
        console.log("📡 AuthGate: Response headers:");
        res.headers.forEach((value, name) => {
          console.log(`    ${name}: ${value}`);
        });

        if (!res.ok) {
          const text = await res.text();
          console.log("❌ AuthGate: Auth failed. Response body:", text);
          if (!cancelled) {
            setAuthed(false);
            setChecking(false);
            if (pathname !== "/login") router.replace("/login");
          }
          return;
        }

        const data = await res.json();
        console.log("✅ AuthGate: Authenticated as", data?.user?.username);

        if (!cancelled) {
          setAuthed(true);
          setChecking(false);

          // ✅ expose username ONCE for layout/topbar
          if (data?.user?.username) {
            (window as any).__AUTH_USERNAME__ = data.user.username;
          }

          if (pathname === "/login") router.replace("/");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("❌ AuthGate: Error checking auth:", message);
        if (err instanceof TypeError && message.includes("fetch")) {
          console.error("   → Network error or CORS issue");
          console.error("   → Full error:", err);
        }
        if (!cancelled) {
          setAuthed(false);
          setChecking(false);
          if (pathname !== "/login") router.replace("/login");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // ⛔ DO NOT add deps

  // ⛔ block render until auth known
  if (checking) return null;

  // ⛔ unauth users only see login
  if (!authed && pathname !== "/login") return null;

  return <>{children}</>;
}
