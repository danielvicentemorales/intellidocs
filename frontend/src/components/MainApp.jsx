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

export default function MainApp({ onLogout }) {
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
        msg: "Backend: no disponible. Verifica la conexión con el servidor.",
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
          text: `Límite alcanzado: Máximo ${guestLimits.maxDocuments} documentos en modo invitado. Crea una cuenta para subir más.`,
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
          { role: "system", text: `Error subiendo "${f.name}": ${e.message}`, time: nowLabel() },
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
        { role: "system", text: "Sube al menos un documento primero.", time: nowLabel() },
      ]);
      return;
    }

    if (isGuest && !guestLimits.canAsk) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          text: `Límite alcanzado: Máximo ${guestLimits.maxQuestions} preguntas en modo invitado. Crea una cuenta para continuar.`,
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

      addAssistantMessageReplacing(tempId, {
        text: data.answer || "(Sin respuesta.)",
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
          ? "Endpoint de chat no encontrado. Falta implementar POST /chat en el backend."
          : msg.includes("401")
          ? "401 No autorizado — revisa tu token."
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
        { role: "system", text: `Error eliminando documento: ${e.message}`, time: nowLabel() },
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
        { role: "system", text: `Error renombrando: ${e.message}`, time: nowLabel() },
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
        { role: "system", text: `Error descargando: ${e.message}`, time: nowLabel() },
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
          <div className="brandLogo">📄</div>
          <div>
            <div className="brandName">IntelliDocs</div>
            <div className="brandSub">Pregunta sobre tus archivos</div>
          </div>
          <button
            className="sidebarCloseBtn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Cerrar panel"
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
          <div className="dropIcon">⬆️</div>
          <div className="dropTitle">Subir documentos</div>
          <div className="dropHint">Arrastra o haz clic para seleccionar</div>
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
          <div className="panelTitle">Tus documentos</div>
          <div className="panelCount">{uploadedDocs.length}</div>
        </div>

        <div className="docs">
          {uploadedDocs.map((d) => (
            <div key={d.id} className={`doc ${d.status}`}>
              <button
                className={`docCheck ${selectedDocs.some((x) => x.id === d.id) ? "on" : ""}`}
                onClick={() => toggleDoc(d.id)}
                title="Incluir/excluir documento"
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
                    {d.status === "uploading" ? "Subiendo" : d.status === "ready" ? "Listo" : "Error"}
                  </span>
                </div>
              </div>

              <div className="docActions">
                <button
                  className="docActionBtn"
                  onClick={() => downloadDoc(d.id, d.name)}
                  title="Descargar"
                  disabled={d.status !== "ready"}
                >
                  ⬇
                </button>
                <button
                  className="docActionBtn"
                  onClick={() => startRename(d)}
                  title="Renombrar"
                  disabled={d.status !== "ready"}
                >
                  ✎
                </button>
                <button className="docActionBtn danger" onClick={() => removeDoc(d.id)} title="Eliminar">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="leftFooter">
          <div className="hintSmall">{apiStatus.msg}</div>
          <button className="logoutBtn" onClick={onLogout}>
            {isGuest ? "Salir" : "Cerrar sesión"}
          </button>
        </div>
      </aside>

      {/* RIGHT: Chat */}
      <main className="right">
        <header className="topbar">
          <button
            className="ghostBtn mobileMenuBtn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir documentos"
          >
            ☰
          </button>

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
                    <span className="chip muted">+{selectedDocs.length - 3} más</span>
                  )}
                </div>
              ) : (
                <span className="mutedText">Sube documentos para comenzar</span>
              )}
            </div>
          </div>

          <div className="topRight">
            <button className="ghostBtn" onClick={newChat}>
              Nuevo chat
            </button>
            <div className="avatar">{user?.email ? user.email[0].toUpperCase() : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}</div>
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
              placeholder={readyDocs.length === 0 ? "Sube documentos primero…" : "Escribe tu pregunta…"}
              disabled={busy}
              rows={1}
            />
            <button
              className="send"
              onClick={() => sendMessage()}
              disabled={busy || !input.trim()}
              title="Enviar"
            >
              ➤
            </button>
          </div>

          <div className="composerMeta">
            <span className="mutedText">
              {readyDocs.length === 0 ? "No hay documentos subidos." : `Buscando en ${selectedDocs.length} documento(s).`}
            </span>
          </div>
        </footer>
      </main>

      {/* Modal de renombrar */}
      {renamingDoc && (
        <div className="modalOverlay" onClick={cancelRename}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modalTitle">Renombrar documento</h3>
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
                Cancelar
              </button>
              <button className="btnPrimary" onClick={confirmRename}>
                Guardar
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
      <div className="emptyCard">
        <div className="emptyHead">Haz preguntas sobre tus documentos</div>
        <div className="emptyBody">
          {disabled ? "Sube al menos un archivo a la izquierda para comenzar." : "Escribe tu pregunta."}
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
            <span className="badge">Asistente</span>
            <div className="actions">
              <button className="iconBtn" onClick={() => copyText(msg.text)} title="Copiar">
                ⧉
              </button>
              <button className="iconBtn" onClick={onRetry} title="Reintentar">
                ↻
              </button>
            </div>
          </div>
        )}

        <div className="text">{msg.isTyping ? <TypingDots /> : msg.text}</div>

        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="sources">
            <button className="sourcesHeader" onClick={onToggleSources}>
              <span>Fuentes</span>
              <span className="mutedText">{msg.sources.length}</span>
              <span className="chev">{msg.sourcesOpen ? "▾" : "▸"}</span>
            </button>

            {msg.sourcesOpen && (
              <div className="sourcesList">
                {msg.sources.map((s) => (
                  <button
                    key={s.id}
                    className="source"
                    onClick={() => alert(`Abrir fuente: ${s.title}`)}
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
    <div className="dots" aria-label="Asistente escribiendo">
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
