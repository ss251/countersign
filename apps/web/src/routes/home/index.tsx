import { useEffect } from "react";
import type { PageProps } from "../../app/routes.ts";
import { navigate } from "../../app/router.tsx";
import { LANDING } from "../../app/routes.ts";

/** The overview is not built yet, so "#/" lands on the most complete view instead of a blank page. */
export default function HomePage({ query }: PageProps) {
  useEffect(() => {
    const q = query.toString();
    navigate(`${LANDING}${q ? `?${q}` : ""}`, { replace: true });
  }, [query]);
  return null;
}
