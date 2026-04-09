import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

/**
 * ✅ En Vercel/Preview/Production: usa VITE_API_URL (Railway)
 * ✅ En local: si no existe env var, cae a localhost:8000 (solo DEV)
 */
const API_BASE =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

if (!API_BASE) console.error("VITE_API_URL is missing in this deployment");

const HEALTH_URL = `${API_BASE}/health`;
const LIST_DOCS_URL = `${API_BASE}/documents`;
const UPLOAD_URL = `${API_BASE}/documents/upload`;
const CHAT_URL = `${API_BASE}/chat`;

export default function MainApp({ onLogout, theme, onToggleTheme }) {
  const {
    isGuest,
    user,
    getToken,
    guestLimits,
    incrementGuestQuestions,
    setGuestDocsCount, // (viene del AuthContext)
  } = useAuth();

  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState(new Set());
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [apiStatus, setApiStatus] = useState({ ok: null, msg: "Checking API..." });

  // Rename modal
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [newName, setNewName] = useState("");

  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    return list.length > 0 ? list : readyDocs; // fallback: all ready docs
  }, [readyDocs, selectedDocIds]);

  function getAuthHeaders(extra = {}) {
    const token = getToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = next + "px";
  }, [input]);

  useEffect(() => {
    (async () => {
      await checkHealth();
      await refreshDocs(); // ✅ también en guest (porque ya hay token)
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  async function checkHealth() {
    try {
      const res = await fetch(HEALTH_URL);
      if (!res.ok) throw new Error(`Health failed (${res.status})`);
      setApiStatus({ ok: true, msg: "Backend: OK" });
    } catch (e) {
      setApiStatus({
        ok: false,
        msg: "Backend unavailable",
      });
    }
  }

  async function refreshDocs() {
    try {
      const res = await fetch(LIST_DOCS_URL, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`List docs failed (${res.status})`);

      const data = await res.json();

      const mapped = (data || []).map((d) => ({
        id: String(d.id),
        name: d.filename,
        sizeBytes: d.file_size ?? 0,
        status: "ready",
      }));

      setUploadedDocs(mapped);

      // ✅ aquí arreglamos el contador real de docs para guest (Opción B)
      if (isGuest) {
        setGuestDocsCount(mapped.length);
      }

      // auto-select once
      setSelectedDocIds((prev) => {
        if (prev.size > 0) return prev;
        return new Set(mapped.map((x) => x.id));
      });
    } catch (e) {
      console.warn(e);
    }
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // ✅ para guest, el límite real lo manejas con el contador del backend (guestLimits.canUpload)
    if (isGuest && !guestLimits.canUpload) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          text: `Upload limit reached: max ${guestLimits.maxDocuments} documents in guest mode. Create an account to upload more.`,
          time: nowLabel(),
        },
      ]);
      return;
    }

    for (const f of files) {
      const tempId = crypto.randomUUID();

      setUploadedDocs((prev) => [
        { id: tempId, name: f.name, sizeBytes: f.size, status: "uploading" },
        ...prev,
      ]);

      try {
        const form = new FormData();
        form.append("file", f);

        const res = await fetch(UPLOAD_URL, {
          method: "POST",
          headers: getAuthHeaders(),
          body: form,
        });

        if (!res.ok) {
          let detail = "";
          try {
            const err = await res.json();
            detail = err?.detail ? ` — ${err.detail}` : "";
          } catch {}
          throw new Error(`Upload failed (${res.status})${detail}`);
        }

        const doc = await res.json();

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
        setMessages((prev) => [
          ...prev,
          { role: "system", text: `Upload error "${f.name}": ${e.message}`, time: nowLabel() },
        ]);
      }
    }

    await refreshDocs();
  }

  function onDrop(e) {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }

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

    if (isGuest && !guestLimits.canAsk) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          text: `Question limit reached: max ${guestLimits.maxQuestions} questions in guest mode. Create an account to continue.`,
          time: nowLabel(),
        },
      ]);
      return;
    }

    if (isGuest) incrementGuestQuestions();

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
          docIds: selectedDocs.map((d) => String(d.id)),
        }),
      });

      if (!res.ok) {
        let detail = "";
        try {
          const err = await res.json();
          detail = err?.detail ? ` — ${err.detail}` : "";
        } catch {}
        throw new Error(`Chat failed (${res.status})${detail}`);
      }

      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);

      const hasSources = data.sources && data.sources.length > 0;
      addAssistantMessageReplacing(tempId, {
        text: data.answer || "(No response.)",
        time: nowLabel(),
        sources: data.sources || [],
        isTyping: false,
        sourcesOpen: hasSources,
      });
    } catch (e) {
      console.error(e);

      const msg = String(e?.message || "");
      const hint =
        msg.includes("404") || msg.toLowerCase().includes("not found")
          ? "Could not reach the chat service. Please try again later."
          : msg.includes("401")
          ? "Your session has expired. Please sign in again."
          : msg.includes("500")
          ? "Something went wrong on our end. Please try again in a moment."
          : "Something went wrong. Please try again.";

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

  async function removeDoc(id) {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed (${res.status})`);
      }

      setUploadedDocs((prev) => prev.filter((d) => d.id !== id));
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      await refreshDocs(); // ✅ para refrescar contador guest
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: "system", text: `Delete error: ${e.message}`, time: nowLabel() },
      ]);
    }
  }

  async function renameDoc(id, filename) {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, {
        method: "PUT",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ filename }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Rename failed (${res.status})`);
      }

      await refreshDocs();
      setRenamingDoc(null);
      setNewName("");
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: "system", text: `Rename error: ${e.message}`, time: nowLabel() },
      ]);
    }
  }

  async function downloadDoc(id, filename) {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}/download`, {
        headers: getAuthHeaders(),
      });

      if (!res.ok) throw new Error(`Download failed (${res.status})`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: "system", text: `Download error: ${e.message}`, time: nowLabel() },
      ]);
    }
  }

  function startRename(doc) {
    setRenamingDoc(doc);
    setNewName(doc.name);
  }

  function cancelRename() {
    setRenamingDoc(null);
    setNewName("");
  }

  function confirmRename() {
    if (renamingDoc && newName.trim()) {
      renameDoc(renamingDoc.id, newName.trim());
    }
  }

  return (
    <div className="shell">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="sidebarBackdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* LEFT: Docs */}
      <aside className={`left ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brandLogo">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="2" y="1" width="12" height="16" rx="2"/>
              <path d="M6 18h10a2 2 0 002-2V6"/>
              <path d="M6 6h5M6 9h7M6 12h4" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <div className="brandName">IntelliDocs</div>
            <div className="brandSub">Document workspace</div>
          </div>
          <button
            className="sidebarCloseBtn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        <div
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="dropIcon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div className="dropTitle">Upload documents</div>
          <div className="dropHint">Drag & drop or click to browse</div>
          <div className="dropMeta">PDF · TXT · DOCX · MD</div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(e.target.files)}
          />
        </div>

        <div className="panelHeader">
          <div className="panelTitle">Documents</div>
          <div className="panelCount">{uploadedDocs.length}</div>
        </div>

        <div className="docs">
          {uploadedDocs.map((d) => (
            <div key={d.id} className={`doc ${d.status}`}>
              <button
                className={`docCheck ${selectedDocs.some((x) => x.id === d.id) ? "on" : ""}`}
                onClick={() => toggleDoc(d.id)}
                title="Include/exclude document"
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

              <div className="docActions">
                <button
                  className="docActionBtn"
                  onClick={() => downloadDoc(d.id, d.name)}
                  title="Download"
                  disabled={d.status !== "ready"}
                >
                  ⬇
                </button>
                <button
                  className="docActionBtn"
                  onClick={() => startRename(d)}
                  title="Rename"
                  disabled={d.status !== "ready"}
                >
                  ✎
                </button>
                <button className="docActionBtn danger" onClick={() => removeDoc(d.id)} title="Delete">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="leftFooter">
          <div className="hintSmall">{apiStatus.msg}</div>
          <button className="logoutBtn" onClick={onLogout}>
            {isGuest ? "Exit" : "Sign out"}
          </button>
        </div>
      </aside>

      {/* RIGHT: Chat */}
      <main className="right">
        <header className="topbar">
          <button
            className="ghostBtn mobileMenuBtn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open documents"
          >
            ☰
          </button>

          <div className="topLeft">
            <div className="title">Document Q&A</div>
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
                <span className="mutedText">Upload documents to get started</span>
              )}
            </div>
          </div>

          <div className="topRight">
            <button className="ghostBtn" onClick={newChat}>
              New chat
            </button>
            <button
              className="themeToggleInline"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              )}
            </button>
            <div className="avatar">{user?.email ? user.email[0].toUpperCase() : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}</div>
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
                      prev.map((x, idx) => (idx === i ? { ...x, sourcesOpen: !x.sourcesOpen } : x))
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
              placeholder={readyDocs.length === 0 ? "Upload a document to begin…" : "Ask a question about your documents…"}
              disabled={busy}
              rows={1}
            />
            <button
              className="send"
              onClick={() => sendMessage()}
              disabled={busy || !input.trim()}
              title="Send"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>

          <div className="composerMeta">
            <span className="mutedText">
              {readyDocs.length === 0 ? "No documents uploaded." : `Searching across ${selectedDocs.length} document(s).`}
            </span>
          </div>
        </footer>
      </main>

      {/* Modal de renombrar */}
      {renamingDoc && (
        <div className="modalOverlay" onClick={cancelRename}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modalTitle">Rename document</h3>
            <input
              type="text"
              className="modalInput"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
                if (e.key === "Escape") cancelRename();
              }}
              autoFocus
            />
            <div className="modalActions">
              <button className="btnSecondary" onClick={cancelRename}>
                Cancel
              </button>
              <button className="btnPrimary" onClick={confirmRename}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ disabled }) {
  return (
    <div className="empty">
      <div className="emptyInner">
        <div className="emptyIcon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
        <h2 className="emptyHead">Ask your documents</h2>
        <p className="emptyBody">
          {disabled
            ? "Upload a document to begin asking grounded questions."
            : "Ask a question to get answers with verifiable citations from your uploaded files."}
        </p>
        {!disabled && (
          <div className="emptyHints">
            <span className="emptyHint">PDF, DOCX, TXT</span>
            <span className="emptyHintSep">·</span>
            <span className="emptyHint">Source-backed answers</span>
            <span className="emptyHintSep">·</span>
            <span className="emptyHint">Verifiable citations</span>
          </div>
        )}
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
            <span className="badge">IntelliDocs</span>
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
    <div className="dots" aria-label="Generating response">
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
  } catch {}
}
