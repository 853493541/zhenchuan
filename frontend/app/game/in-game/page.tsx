import { cookies } from "next/headers";
import InGameClient from "@/app/game/screens/in-game/InGameClient";

type PageProps = {
  searchParams: {
    gameId?: string;
  };
};

export default async function Page({ searchParams }: PageProps) {
  const gameId = searchParams.gameId;
  if (!gameId) return <div>Missing gameId</div>;

  const cookieStore = cookies();

  // Only used for server-side calls to backend for auth verification
  // In production, this would be set via BACKEND_URL env var pointing to internal backend
  // For now, we'll skip server-side token fetch - client will get it via /api/auth/token
  const backendUrl = process.env.BACKEND_URL || "http://localhost:5000";

  const meRes = await fetch(`${backendUrl}/api/auth/me`, {
    cache: "no-store",
    headers: {
      cookie: cookieStore.toString(),
    },
  });

  if (!meRes.ok) {
    return <div>Not logged in</div>;
  }

  const meData = await meRes.json();
  const me = meData.user as {
    uid: string;
    username: string;
  };

  // Don't fetch token on server - let client do it
  // Server can't reliably reach backend in production
  // Client will fetch via Next.js API route instead

  return (
    <InGameClient
      gameId={gameId}
      selfUserId={me.uid}
      selfUsername={me.username}
      authToken=""
    />
  );
}
