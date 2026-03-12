import { cookies } from "next/headers";
import InGameClient from "./InGameClient";

interface Props {
  searchParams: {
    gameId?: string;
  };
}

async function getMe() {
  const cookieStore = cookies();

  const backendUrl =
    process.env.BACKEND_URL ?? "http://localhost:5000";

  const res = await fetch(`${backendUrl}/api/auth/me`, {
    cache: "no-store",
    headers: {
      cookie: cookieStore.toString(),
    },
  });

  if (!res.ok) return null;

  const data = await res.json();
  return data.user as { uid: string; username: string };
}

export default async function InGamePage({ searchParams }: Props) {
  const { gameId } = searchParams;

  if (!gameId) return <div>Missing gameId</div>;

  const me = await getMe();
  if (!me) return <div>Not logged in</div>;

  return (
    <InGameClient
      gameId={gameId}
      selfUserId={me.uid}
      selfUsername={me.username}
    />
  );
}
