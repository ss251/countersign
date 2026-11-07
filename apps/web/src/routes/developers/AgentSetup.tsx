import { useRef, useState, type JSX, type KeyboardEvent } from "react";
import { CopyButton, cx } from "../../ui/primitives.tsx";
import { CLIENTS, LIMITS, LIMITS_NOTE, LOGIN, LOGIN_NOTE, type ClientId, type Snippet } from "./agents.ts";
import { ClientMark } from "./marks.tsx";

/**
 * "Use it from your agent" (STEER-0625): one tab per client, on the offer page's toggles. Every panel stays in the
 * page (the others hidden), so each one reads whole, with the same three steps: sign in, add the server, give the
 * agent its rules.
 */
export function AgentSetup({ initial = "claude" }: { initial?: ClientId }): JSX.Element {
  const [active, setActive] = useState<ClientId>(initial);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = CLIENTS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % CLIENTS.length
        : event.key === "ArrowLeft"
          ? (index + last) % CLIENTS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const client = CLIENTS[next];
    if (client === undefined) return;
    event.preventDefault();
    setActive(client.id);
    tabs.current[next]?.focus();
  };

  return (
    <section className="gs agents" data-testid="dev-agents" aria-labelledby="dev-agents-title">
      <h2 id="dev-agents-title" className="gs__title">
        Use it from your agent
      </h2>
      <p className="gs__text">
        Sign in once, add the MCP server to your client, and give your agent the rules. If a config file already lists
        servers, add countersign next to them.
      </p>

      <div className="toggles agents__tabs" role="tablist" aria-label="Agent client">
        {CLIENTS.map((client, index) => (
          <button
            key={client.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`agent-tab-${client.id}`}
            aria-controls={`agent-panel-${client.id}`}
            aria-selected={active === client.id}
            tabIndex={active === client.id ? 0 : -1}
            className={cx("toggle", active === client.id && "is-on")}
            onClick={() => setActive(client.id)}
            onKeyDown={(event) => onKey(event, index)}
            data-testid={`agent-tab-${client.id}`}
          >
            <ClientMark id={client.id} />
            {client.name}
          </button>
        ))}
      </div>

      {CLIENTS.map((client) => (
        <div
          key={client.id}
          role="tabpanel"
          id={`agent-panel-${client.id}`}
          aria-labelledby={`agent-tab-${client.id}`}
          hidden={active !== client.id}
          className="agents__panel"
          data-testid={`agent-${client.id}`}
        >
          <ol className="agents__steps">
            <li className="agents__step">
              <h3 className="agents__step-title">Sign in once</h3>
              <Block snippet={{ where: "Terminal", lang: "sh", text: LOGIN }} copy="the login command" />
              <p className="agents__note">{LOGIN_NOTE}</p>
              <p className="agents__note">{LIMITS_NOTE}</p>
              <Block snippet={{ where: "Terminal", lang: "sh", text: LIMITS }} copy="the limits command" />
            </li>
            <li className="agents__step">
              <h3 className="agents__step-title">Add the MCP server</h3>
              {client.mcp.map((snippet) => (
                <Block key={snippet.where} snippet={snippet} copy={copyLabel(snippet)} />
              ))}
            </li>
            <li className="agents__step">
              <h3 className="agents__step-title">Give your agent the rules</h3>
              <Block snippet={client.rules} copy={copyLabel(client.rules)} />
            </li>
          </ol>
        </div>
      ))}

      <p className="gs__foot">
        Agents can read this page as markdown: <a href="/llms.txt">/llms.txt</a>
      </p>
    </section>
  );
}

/** "Copy the Claude Code command", "Copy .cursor/mcp.json": only the open panel is in the accessibility tree. */
function copyLabel(snippet: Snippet): string {
  return snippet.lang === "sh" ? `the ${snippet.where} command` : snippet.where;
}

function Block({ snippet, copy }: { snippet: Snippet; copy: string }) {
  return (
    <div className="command" data-lang={snippet.lang}>
      <div className="command__head">
        <p className="agents__where mono">{snippet.where}</p>
        <CopyButton value={snippet.text} label={copy} />
      </div>
      {snippet.note !== undefined ? <p className="agents__note">{snippet.note}</p> : null}
      <pre className="command__body mono">{snippet.text}</pre>
    </div>
  );
}
