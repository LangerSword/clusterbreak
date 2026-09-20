import { useEffect, useRef, useState } from "react";
import { chatWithRig, harnessEnv, type ChatMessage, type RigStack } from "../api";

/**
 * Chat with the model actually running on a provisioned rig.
 *
 * The browser calls Clusterbreak over HTTPS; Clusterbreak assumes the connect
 * role and calls the instance's llama.cpp server with the per-stack bearer key.
 * Nothing is mocked — if the instance is still pulling the model, you get the
 * real error, not a fake reply.
 */
export function ChatDrawer({
  sessionId,
  stack,
  onClose,
}: {
  sessionId: string;
  stack: RigStack;
  onClose: () => void;
}) {
  // No seeded system prompt: the proxy prepends the model's real deployment
  // facts (instance type, GPU, weights file), and two system messages in a row
  // break strict chat templates.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxTokens, setMaxTokens] = useState(256);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const endpoint = stack.outputs.Node1Endpoint ?? stack.outputs.LlamaCppUrl ?? "";
  const visible = messages.filter((m) => m.role !== "system");

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const r = await chatWithRig(sessionId, stack.name, next, maxTokens);
      setMessages([...next, { role: "assistant", content: r.reply || "(empty reply)" }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    });
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Chat with your rig">
        <header className="drawer-head">
          <span className="live-dot" aria-hidden="true" />
          <div className="drawer-title">
            <b>{stack.name}</b>
            <span className="drawer-sub">
              {stack.status} · {endpoint || "no endpoint yet"}
            </span>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close chat">
            ✕
          </button>
        </header>

        <div className="drawer-msgs" ref={listRef}>
          {visible.length === 0 && (
            <p className="note">
              Ask the model something. The first call can take a while — the instance downloads the GGUF, then
              loads it into VRAM before it answers.
            </p>
          )}
          {visible.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="msg-role">{m.role === "user" ? "you" : "rig"}</span>
              <div className="msg-body">{m.content}</div>
            </div>
          ))}
          {visible.length === 0 && !busy && (
            <p className="note">
              This talks to the model on your own EC2 instance. Ask it about its hardware — the proxy tells
              it where it actually runs, so it answers from the stack instead of guessing.
            </p>
          )}
          {busy && (
            <div className="msg assistant">
              <span className="msg-role">rig</span>
              <div className="msg-body pending">
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
                generating on your instance…
              </div>
            </div>
          )}
          {error && (
            <div className="msg error">
              <span className="msg-role">error</span>
              <div className="msg-body">{error}</div>
            </div>
          )}
        </div>

        <div className="drawer-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="message the model running on your EC2 instance… (enter to send, shift+enter for newline)"
            rows={2}
          />
          <div className="drawer-actions">
            <label className="drawer-max">
              max tokens
              <select value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))}>
                <option value={128}>128</option>
                <option value={256}>256</option>
                <option value={512}>512</option>
                <option value={768}>768</option>
              </select>
            </label>
            <button className="copy-verdict" onClick={() => void send()} disabled={busy || !input.trim()}>
              {busy ? "GENERATING…" : "SEND →"}
            </button>
          </div>
          <p className="note">
            Proxied through the Clusterbreak API — your browser never holds the instance key. Replies are
            capped at {maxTokens} tokens because the API gateway closes at 30s (for longer generations, point a
            harness at the endpoint below). The proxy also tells the model its real deployment facts — instance
            type, model file, region — so asking it where it runs gets an answer instead of a guess.
          </p>
        </div>

        <details className="drawer-harness">
          <summary>use this rig from a harness (opencode, any OpenAI client)</summary>
          <pre>{harnessEnv(endpoint, showKey ? stack.apiKey : null)}</pre>
          <div className="drawer-actions">
            <button onClick={() => setShowKey((v) => !v)}>{showKey ? "HIDE KEY" : "REVEAL KEY"}</button>
            <button
              onClick={() =>
                copy("env", harnessEnv(endpoint, showKey ? stack.apiKey : null))
              }
            >
              {copied === "env" ? "COPIED ✓" : "COPY ENV"}
            </button>
          </div>
          <p className="note">
            Port 8080 is open with the per-stack key as the gate — that's what makes this work from any machine
            without pre-knowing your IP. Point any OpenAI-compatible client at it; the model name is{" "}
            <code>local</code>.
          </p>
        </details>
      </aside>
    </div>
  );
}
