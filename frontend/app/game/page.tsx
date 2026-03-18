"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GamePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home since the game lobby is now merged there
    router.push("/");
  }, [router]);

  return null;
}
