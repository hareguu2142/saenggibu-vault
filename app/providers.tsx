"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new ConvexReactClient(
      process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud",
    ),
  );
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
