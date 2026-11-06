import type { PageProps } from "../../app/routes.ts";
import { ONBOARDING } from "./doc.ts";
import { DevelopersView } from "./View.tsx";
import "./developers.css";

export const surface = "desk";

export default function DevelopersPage(_props: PageProps) {
  return <DevelopersView markdown={ONBOARDING} />;
}
