import type { PageProps } from "../../app/routes.ts";
import "../../ui/page.css";
import { SellerDashboard } from "./Dashboard.tsx";
import { PublishWizard } from "./Wizard.tsx";
import "./seller.css";

export default function SellerPage({ params, query }: PageProps) {
  if (params[0] === "publish") return <PublishWizard />;
  return <SellerDashboard query={query} />;
}
