import type { PageProps } from "../../app/routes.ts";

export default function OverviewPage(_props: PageProps) {
  return (
    <section style={{ maxWidth: "var(--content)", margin: "0 auto", padding: "var(--sp-10) var(--sp-6)" }}>
      <h1>Overview</h1>
    </section>
  );
}
