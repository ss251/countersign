import { RAIL_LABEL } from "../../lib/format.ts";
import { railTermLines } from "../../lib/terms.ts";
import type { RailDeclaration, RailId } from "../../lib/types.ts";

/** The offer's terms, rail by rail, from each rail's own declaration. */
export function OfferTerms({
  rails,
  declarations,
  deadline,
}: {
  rails: RailId[];
  declarations: RailDeclaration[] | undefined;
  deadline: number;
}) {
  return (
    <>
      {rails.map((id) => {
        const declaration = declarations?.find((d) => d.id === id);
        return (
          <div key={id} className="terms__rail" data-testid={`terms-${id}`}>
            <h3 className="terms__rail-title">{RAIL_LABEL[id]}</h3>
            <dl className="terms">
              {railTermLines(declaration, deadline).map(([term, sentence]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{sentence}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </>
  );
}
