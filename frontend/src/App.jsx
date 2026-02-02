import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

/**
 * IntelliDocs Frontend (Fixed for your current FastAPI routes)
 *
 * Backend routes you CURRENTLY have:
 * ✅ GET  /health
 * ✅ GET  /documents
 * ✅ POST /documents/upload   (multipart field: "file")  -> returns ONE DocumentOut
 *
 * Auth:
 * - Your backend protects /documents/* with get_current_user
 * - This frontend automatically sends Authorization: Bearer <token>
 *   if localStorage has a key named "token".
 *
 * Chat:
 * ⚠️ You DO NOT have a chat endpoint yet.
 * This frontend will show a clear message until you implement POST /chat (or update CHAT_URL).
 */

const API_BASE = "http://localhost:8000"; // keep "" if using Vite proxy; otherwise set "http://localhost:8000"

const HEALTH_URL = `${API_BASE}/health`;
const LIST_DOCS_URL = `${API_BASE}/documents`;
const UPLOAD_URL = `${API_BASE}/documents/upload`;

// TODO: implement this endpoint in FastAPI then this will work.
const CHAT_URL = `${API_BASE}/chat`; // or `${API_BASE}/documents/chat` if you create it there

function getAuthHeaders(extra = {}) {
  const token = localStorage.getItem("token");
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

export default function App() {
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState(new Set());
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [apiStatus, setApiStatus] = useState({ ok: null, msg: "Checking API..." });

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  const readyDocs = useMemo(
    () => uploadedDocs.filter((d) => d.status === "ready"),
    [uploadedDocs]
  );

  const selectedDocs = useMemo(() => {
    const set = selectedDocIds;
    const list = readyDocs.filter((d) => set.has(d.id));
    // If none selected, fallback to all ready docs
    return list.length > 0 ? list : readyDocs;
  }, [readyDocs, selectedDocIds]);

  // scroll to bottom on new messages / typing
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy]);

  // auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = next + "px";
  }, [input]);

  // Initial: check health + load docs
  useEffect(() => {
    (async () => {
      await checkHealth();
      await refreshDocs();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkHealth() {
    try {
      const res = await fetch(HEALTH_URL);
      if (!res.ok) throw new Error(`Health failed (${res.status})`);
      setApiStatus({ ok: true, msg: "Backend: OK" });
    } catch (e) {
      setApiStatus({
        ok: false,
        msg:
          "Backend: not reachable. Start FastAPI on http://localhost:8000. " +
          "If you are NOT using Vite proxy, set API_BASE to http://localhost:8000.",
      });
    }
  }

  async function refreshDocs() {
    try {
      const res = await fetch(LIST_DOCS_URL, {
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        // Usually 401 if token missing
        throw new Error(`List docs failed (${res.status})`);
      }

      const data = await res.json(); // expected list[DocumentOut]
      const mapped = (data || []).map((d) => ({
        id: String(d.id),
        name: d.filename,
        sizeBytes: d.file_size ?? 0,
        status: "ready",
      }));

      setUploadedDocs(mapped);

      // If no selection yet, select all automatically
      setSelectedDocIds((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set();
        mapped.forEach((x) => next.add(x.id));
        return next;
      });
    } catch (e) {
      console.warn(e);
      // don't spam; just show one system message if empty
      setMessages((prev) => {
        if (prev.some((m) => m.role === "system" && m.text.includes("documents list"))) return prev;
        return [
          ...prev,
          {
            role: "system",
            text:
              "Couldn't load documents list. If you're getting 401, you need to login and set localStorage token.",
            time: nowLabel(),
          },
        ];
      });
    }
  }

  // ---------- Upload ----------
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // Your backend accepts ONE file ("file") per request.
    // We'll upload sequentially (one-by-one).
    for (const f of files) {
      const tempId = crypto.randomUUID();

      // optimistic insert
      setUploadedDocs((prev) => [
        { id: tempId, name: f.name, sizeBytes: f.size, status: "uploading" },
        ...prev,
      ]);

      try {
        const form = new FormData();
        form.append("file", f); // MUST match UploadFile param name: file

        const res = await fetch(UPLOAD_URL, {
          method: "POST",
          headers: getAuthHeaders(), // adds Authorization if token exists
          body: form,
        });

        if (!res.ok) {
          let detail = "";
          try {
            const err = await res.json();
            detail = err?.detail ? ` — ${err.detail}` : "";
          } catch {
            // ignore
          }
          throw new Error(`Upload failed (${res.status})${detail}`);
        }

        // Backend returns ONE DocumentOut object
        const doc = await res.json();

        // Replace temp optimistic with real doc
        setUploadedDocs((prev) =>
          prev.map((d) =>
            d.id === tempId
              ? {
                  id: String(doc.id),
                  name: doc.filename,
                  sizeBytes: doc.file_size ?? f.size,
                  status: "ready",
                }
              : d
          )
        );

        // auto-select the uploaded doc
        setSelectedDocIds((prev) => {
          const next = new Set(prev);
          next.add(String(doc.id));
          return next;
        });
      } catch (e) {
        console.error(e);
        setUploadedDocs((prev) =>
          prev.map((d) => (d.id === tempId ? { ...d, status: "error" } : d))
        );

        const msg = String(e?.message || "");
        const hint = msg.includes("401")
          ? `Upload failed for "${f.name}". 401 Unauthorized — you need a token in localStorage ("token").`
          : `Upload failed for "${f.name}". ${msg}`;

        setMessages((prev) => [
          ...prev,
          { role: "system", text: hint, time: nowLabel() },
        ]);
      }
    }

    // Optional: refresh list after uploading (keeps DB ids consistent)
    await refreshDocs();
  }

  function onDrop(e) {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }

  // ---------- Chat ----------
  function nowLabel() {
    try {
      return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function addAssistantMessageReplacing(tempId, payload) {
    setMessages((prev) =>
      prev.map((m) => (m._tempId === tempId ? { ...payload, role: "assistant" } : m))
    );
  }

  async function sendMessage(questionOverride) {
    const question = (questionOverride ?? input).trim();
    if (!question || busy) return;

    if (readyDocs.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: "system", text: "Upload at least one document first.", time: nowLabel() },
      ]);
      return;
    }

    const time = nowLabel();
    setMessages((prev) => [...prev, { role: "user", text: question, time }]);
    setInput("");
    setBusy(true);

    const tempId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "", time: nowLabel(), sources: [], _tempId: tempId, isTyping: true },
    ]);

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          conversationId,
          question,
          docIds: selectedDocs.map((d) => d.id),
        }),
      });

      if (!res.ok) {
        let detail = "";
        try {
          const err = await res.json();
          detail = err?.detail ? ` — ${err.detail}` : "";
        } catch {
          // ignore
        }
        throw new Error(`Chat failed (${res.status})${detail}`);
      }

      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);

      addAssistantMessageReplacing(tempId, {
        text: data.answer || "(No answer returned.)",
        time: nowLabel(),
        sources: data.sources || [],
        isTyping: false,
        sourcesOpen: true,
      });
    } catch (e) {
      console.error(e);

      const msg = String(e?.message || "");
      const hint =
        msg.includes("404") || msg.toLowerCase().includes("not found")
          ? "Chat endpoint not found. You still need to implement POST /chat in FastAPI (or change CHAT_URL)."
          : msg.includes("401")
          ? "401 Unauthorized — you need a token in localStorage ('token')."
          : msg;

      addAssistantMessageReplacing(tempId, {
        text: hint,
        time: nowLabel(),
        sources: [],
        isTyping: false,
        sourcesOpen: false,
      });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function newChat() {
    setConversationId(crypto.randomUUID());
    setMessages([]);
  }

  function toggleDoc(id) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeDoc(id) {
    setUploadedDocs((prev) => prev.filter((d) => d.id !== id));
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="shell">
      {/* LEFT: Docs */}
      <aside className="left">
        <div className="brand">
          <div className="brandLogo">🗂️</div>
          <div>
            <div className="brandName">IntelliDocs</div>
            <div className="brandSub">Ask questions over your files</div>
          </div>
        </div>

        <div
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="dropIcon">⬆️</div>
          <div className="dropTitle">Upload documents</div>
          <div className="dropHint">Drag & drop, or click to browse</div>
          <div className="dropMeta">PDF, TXT, DOC, DOCX, MD</div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(e.target.files)}
          />
        </div>

        <div className="panelHeader">
          <div className="panelTitle">Your documents</div>
          <div className="panelCount">{uploadedDocs.length}</div>
        </div>

        <div className="docs">
          {uploadedDocs.map((d) => (
            <div key={d.id} className={`doc ${d.status}`}>
              <button
                className={`docCheck ${selectedDocs.some((x) => x.id === d.id) ? "on" : ""}`}
                onClick={() => toggleDoc(d.id)}
                title="Include/exclude this doc"
                disabled={d.status !== "ready"}
              >
                ✓
              </button>

              <div className="docMain">
                <div className="docName" title={d.name}>
                  {d.name}
                </div>
                <div className="docSub">
                  <span>{formatBytes(d.sizeBytes)}</span>
                  <span className={`tag ${d.status}`}>
                    {d.status === "uploading" ? "Uploading" : d.status === "ready" ? "Ready" : "Error"}
                  </span>
                </div>
              </div>

              <button className="docX" onClick={() => removeDoc(d.id)} title="Remove">
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="leftFooter">
          <div className="hintSmall">
            {apiStatus.msg}
            {apiStatus.ok === false && (
              <>
                <br />
                Tip: If using Vite proxy, keep API_BASE="". If not, set API_BASE="http://localhost:8000".
              </>
            )}
          </div>
        </div>
      </aside>

      {/* RIGHT: Chat */}
      <main className="right">
        <header className="topbar">
          <div className="topLeft">
            <div className="title">Chat</div>
            <div className="subtitle">
              {selectedDocs.length > 0 ? (
                <div className="chips">
                  {selectedDocs.slice(0, 3).map((d) => (
                    <span key={d.id} className="chip" title={d.name}>
                      {truncate(d.name, 22)}
                    </span>
                  ))}
                  {selectedDocs.length > 3 && (
                    <span className="chip muted">+{selectedDocs.length - 3} more</span>
                  )}
                </div>
              ) : (
                <span className="mutedText">Upload documents to begin</span>
              )}
            </div>
          </div>

          <div className="topRight">
            <button className="ghostBtn" onClick={newChat}>
              New chat
            </button>
            <div className="avatar">🙂</div>
          </div>
        </header>

        <section className="chat">
          {messages.length === 0 ? (
            <Empty disabled={readyDocs.length === 0} />
          ) : (
            <div className="thread">
              {messages.map((m, i) => (
                <Message
                  key={i}
                  msg={m}
                  onRetry={() => {
                    const lastUser = [...messages].reverse().find((x) => x.role === "user");
                    if (lastUser) sendMessage(lastUser.text);
                  }}
                  onToggleSources={() => {
                    setMessages((prev) =>
                      prev.map((x, idx) =>
                        idx === i ? { ...x, sourcesOpen: !x.sourcesOpen } : x
                      )
                    );
                  }}
                />
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </section>

        <footer className="composer">
          <div className="composerInner">
            <textarea
              ref={textareaRef}
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                readyDocs.length === 0
                  ? "Upload documents first…"
                  : "Ask something… (Chat needs backend endpoint)"
              }
              disabled={busy}
              rows={1}
            />
            <button
              className="send"
              onClick={() => sendMessage()}
              disabled={busy || !input.trim()}
              title="Send"
            >
              ➤
            </button>
          </div>

          <div className="composerMeta">
            <span className="mutedText">
              {readyDocs.length === 0
                ? "No documents uploaded."
                : `Searching ${selectedDocs.length} active document(s).`}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function Empty({ disabled }) {
  return (
    <div className="empty">
      <div className="emptyCard">
        <div className="emptyHead">Ask questions over your documents</div>
        <div className="emptyBody">
          {disabled
            ? "Upload at least one file on the left to start."
            : "Type your question. (Chat endpoint must exist on backend.)"}
        </div>
      </div>
    </div>
  );
}

function Message({ msg, onRetry, onToggleSources }) {
  if (msg.role === "system") {
    return <div className="system">{msg.text}</div>;
  }

  const isUser = msg.role === "user";
  return (
    <div className={`row ${isUser ? "userRow" : "aiRow"}`}>
      <div className={`card ${isUser ? "userCard" : "aiCard"}`}>
        {!isUser && (
          <div className="metaTop">
            <span className="badge">Assistant</span>
            <div className="actions">
              <button className="iconBtn" onClick={() => copyText(msg.text)} title="Copy">
                ⧉
              </button>
              <button className="iconBtn" onClick={onRetry} title="Retry">
                ↻
              </button>
            </div>
          </div>
        )}

        <div className="text">{msg.isTyping ? <TypingDots /> : msg.text}</div>

        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="sources">
            <button className="sourcesHeader" onClick={onToggleSources}>
              <span>Sources</span>
              <span className="mutedText">{msg.sources.length}</span>
              <span className="chev">{msg.sourcesOpen ? "▾" : "▸"}</span>
            </button>

            {msg.sourcesOpen && (
              <div className="sourcesList">
                {msg.sources.map((s) => (
                  <button
                    key={s.id}
                    className="source"
                    onClick={() => alert(`Open source: ${s.title}`)}
                  >
                    <span className="srcIcon">📄</span>
                    <span className="srcTitle">{s.title}</span>
                    {s.pageLabel && <span className="srcPage">{s.pageLabel}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="metaBottom">{msg.time || ""}</div>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="dots" aria-label="Assistant typing">
      <span />
      <span />
      <span />
    </div>
  );
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || "");
  } catch {
    // ignore
  }
}
