import type { PageProps } from "../../app/routes.ts";
import { ONBOARDING } from "./doc.ts";
import { GetStartedView } from "./View.tsx";
import "./get-started.css";

export const surface = "desk";

export default function GetStartedPage(_props: PageProps) {
  return <GetStartedView markdown={ONBOARDING} />;
}
