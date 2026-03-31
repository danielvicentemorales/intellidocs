import React, { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

/* ── Particle canvas for hero background ── */
function ParticleCanvas() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const animRef = useRef(null);

  const handleMouse = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles;

    function resize() {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    }

    function init() {
      resize();
      const count = Math.floor((w * h) / 18000);
      particles = Array.from({ length: Math.min(count, 60) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        color: Math.random() > 0.5 ? 'rgba(59,130,246,0.5)' : 'rgba(6,214,160,0.4)',
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // lines to nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const dist = dx * dx + dy * dy;
          if (dist < 14400) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(59,130,246,${0.06 * (1 - dist / 14400)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        // mouse interaction
        const mdx = p.x - mx, mdy = p.y - my;
        const mdist = mdx * mdx + mdy * mdy;
        if (mdist < 22500) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mx, my);
          ctx.strokeStyle = `rgba(6,214,160,${0.18 * (1 - mdist / 22500)})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
      animRef.current = requestAnimationFrame(draw);
    }

    init();
    draw();
    window.addEventListener('resize', () => { resize(); });
    return () => { cancelAnimationFrame(animRef.current); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="heroParticles"
      onMouseMove={handleMouse}
      onMouseLeave={() => { mouseRef.current = { x: -1000, y: -1000 }; }}
    />
  );
}

/* ── Scroll reveal hook (re-triggers on enter/leave) ── */
function useReveal() {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('revealed'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        const children = e.target.querySelectorAll('.reveal-child');
        if (e.isIntersecting) {
          if (children.length) {
            children.forEach((ch, i) => {
              ch.style.transitionDelay = `${i * 90}ms`;
              ch.classList.add('revealed');
            });
          }
          e.target.classList.add('revealed');
        } else {
          // reset when leaving viewport so it re-animates on re-entry
          if (children.length) {
            children.forEach((ch) => {
              ch.style.transitionDelay = '0ms';
              ch.classList.remove('revealed');
            });
          }
          e.target.classList.remove('revealed');
        }
      }),
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ── Architecture Diagram (horizontal flow) ── */
const archModules = [
  {
    label: 'Auth', color: '#6366f1',
    children: [
      { name: 'User', detail: 'email, password, role' },
      { name: 'AuthService', detail: 'login(), logout(), validateToken()' },
      { name: 'SessionToken', detail: 'token, expiry, userId' },
    ],
  },
  {
    label: 'Documents', color: '#3b82f6',
    children: [
      { name: 'DocumentManager', detail: 'upload(), list(), delete()' },
      { name: 'Document', detail: 'id, filename, format, chunks' },
      { name: 'IngestionService', detail: 'ingest(), validateFormat()' },
      { name: 'TextProcessor', detail: 'clean(), normalize(), split()' },
    ],
  },
  {
    label: 'RAG', color: '#06d6a0',
    children: [
      { name: 'EmbeddingService', detail: 'embed(), embedBatch()' },
      { name: 'VectorStore', detail: 'upsert(), similaritySearch()' },
      { name: 'Retriever', detail: 'retrieve()' },
      { name: 'RAGEngine', detail: 'ask(), buildContext()' },
      { name: 'LLMService', detail: 'generate()' },
    ],
  },
  {
    label: 'Chat', color: '#f59e0b',
    children: [
      { name: 'ChatSession', detail: 'id, userId, history' },
      { name: 'Query', detail: 'text, timestamp' },
      { name: 'Answer', detail: 'text, citations, model' },
    ],
  },
];

/* ── Smooth scroll helper (offset for fixed nav) ── */
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const container = el.closest('.proLanding');
  if (!container) return;
  const navHeight = 72;
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scrollTop = container.scrollTop + (elRect.top - containerRect.top) - navHeight;
  container.scrollTo({ top: scrollTop, behavior: 'smooth' });
}

/* ── Main component ── */
export default function LandingPage({ onNavigateToAuth, theme, onToggleTheme }) {
  const { enterAsGuest } = useAuth();
  const [legalModal, setLegalModal] = React.useState(null);
  useReveal();

  return (
    <div className="proLanding">
      {/* ── Nav ── */}
      <header className="proNav">
        <div className="proNavInner">
          <div className="proLogo">
            <span className="proLogoMark">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="1" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M6 18h10a2 2 0 002-2V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M6 6h5M6 9h7M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
            <span className="proLogoText">IntelliDocs</span>
          </div>
          <nav className="proNavLinks">
            <span onClick={() => scrollToSection('section-features')}>Features</span>
            <span onClick={() => scrollToSection('section-how-it-works')}>How it works</span>
            <span onClick={() => scrollToSection('section-architecture')}>Architecture</span>
          </nav>
          <div className="proNavActions">
            <button className="proBtnGhost proBtnSm" onClick={onToggleTheme}>
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
            <button className="proBtnGhost proBtnSm" onClick={onNavigateToAuth}>Sign in</button>
            <button className="proBtnPrimary proBtnSm" onClick={onNavigateToAuth}>Get started</button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section id="section-demo" className="proHero">
        <ParticleCanvas />
        <div className="proHeroContent">
          <div className="proBadge">
            <span className="proBadgeDot" />
            AI-powered document intelligence
          </div>
          <h1 className="proHeroTitle">
            Ask your documents,{' '}
            <span className="proGradientText">get verified answers</span>
          </h1>
          <p className="proHeroSub">
            Upload files and get precise, citation-backed responses grounded in your
            actual content. Supports PDF, DOCX, and TXT with traceable references.
          </p>
          <div className="proHeroActions">
            <button className="proBtnPrimary proBtnLg" onClick={onNavigateToAuth}>
              Start for free
              <span className="proBtnArrow">&rarr;</span>
            </button>
            <button className="proBtnGhost proBtnLg" onClick={enterAsGuest}>Live demo</button>
          </div>
        </div>

        <div className="proMockWrap">
          <div className="proMockGlow" />
          <div className="proMock">
            <div className="proMockTitlebar">
              <div className="proMockDots"><span /><span /><span /></div>
              <span className="proMockTitle">IntelliDocs Workspace</span>
              <span className="proMockFileTag">Report-Q4.pdf</span>
            </div>
            <div className="proMockBody">
              <aside className="proMockSidebar">
                <div className="proMockSideLabel">Workspace</div>
                <div className="proMockSideItem active">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  New chat
                </div>
                <div className="proMockSideItem">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 6h6M5 8.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  Documents
                </div>
                <div className="proMockSideItem">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  History
                </div>
              </aside>
              <div className="proMockChat">
                <div className="proMockMsg proMockUser">Summarize the key findings from section 3.</div>
                <div className="proMockMsg proMockAI">
                  <div className="proMockAILabel">IntelliDocs</div>
                  The document outlines a structured framework with internal cross-references
                  designed to facilitate informed decision-making and rapid retrieval.
                  <div className="proMockCites"><span>Page 4</span><span>Page 6</span><span>Section 3.2</span></div>
                </div>
                <div className="proMockInputBar">
                  <span>Ask a question about your document...</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
              <aside className="proMockPanel">
                <div className="proMockPanelSection">
                  <div className="proMockPanelLabel">Source Document</div>
                  <div className="proMockPanelFile">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="1.5" width="10" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 5h5M5.5 7.5h4M5.5 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    Report-Q4.pdf
                  </div>
                  <div className="proMockPanelStatus">Ready for queries</div>
                </div>
                <div className="proMockPanelSection">
                  <div className="proMockPanelLabel">References Found</div>
                  <div className="proMockPanelStat">3 citations</div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      {/* ── Core Capabilities ── */}
      <section id="section-features" className="proCore">
        <div className="proCoreInner">
          <div className="proSectionHeader reveal">
            <h2>Everything you need to understand your documents</h2>
            <p>IntelliDocs combines document ingestion, contextual search, and citation-backed answers so you can trust every result.</p>
          </div>
          <div className="proCoreGrid reveal">
            <article className="proCoreHero reveal-child">
              <div className="proCoreIconWrap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4h16v16H4z" rx="2"/><path d="M4 9h16M9 9v11"/></svg>
              </div>
              <h3>Document ingestion</h3>
              <p>Upload PDF, DOCX, and TXT files. They are securely indexed and ready for instant querying within your workspace.</p>
              <ul><li>Multi-format support</li><li>Background processing</li><li>Project-based organization</li></ul>
            </article>
            <article className="proCoreCard reveal-child">
              <div className="proCoreIconWrap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6"/></svg>
              </div>
              <h3>Source-backed answers</h3>
              <p>Every response is anchored to specific pages and sections from your documents.</p>
              <ul><li>Clickable citations</li><li>Visible source context</li><li>Full query history</li></ul>
            </article>
            <article className="proCoreCard reveal-child">
              <div className="proCoreIconWrap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/><circle cx="15" cy="15" r="2"/></svg>
              </div>
              <h3>Clean experience</h3>
              <p>A focused chat interface designed for reading, not visual noise.</p>
              <ul><li>Light and dark modes</li><li>Keyboard shortcuts</li><li>Built for daily workflows</li></ul>
            </article>
          </div>
        </div>
      </section>

      {/* ── Workflow ── */}
      <section className="proWorkflow">
        <div className="proWorkflowInner">
          <h2 className="proWorkflowTitle reveal">From upload to answer in three steps</h2>
          <div className="wfMinimal reveal">
            <div className="wfMinStep">
              <div className="wfMinIcon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <h3>Upload</h3>
              <p>Add your documents. They are securely indexed and ready for queries.</p>
            </div>
            <div className="wfMinLine"><div className="wfMinLineInner" /></div>
            <div className="wfMinStep">
              <div className="wfMinIcon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
              </div>
              <h3>Retrieve</h3>
              <p>Relevant passages are extracted and matched to your question.</p>
            </div>
            <div className="wfMinLine"><div className="wfMinLineInner" /></div>
            <div className="wfMinStep">
              <div className="wfMinIcon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="3"/></svg>
              </div>
              <h3>Answer</h3>
              <p>A grounded response is generated with verifiable citations.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── RAG Pipeline (detailed) ── */}
      <section id="section-how-it-works" className="proRetrieval">
        <div className="proRetrievalInner">
          <div className="proRetrievalGrid">
            <div className="proRetrievalText reveal">
              <h2>How IntelliDocs retrieves answers</h2>
              <p>
                IntelliDocs processes uploaded documents through a retrieval-augmented
                generation pipeline that searches relevant context before generating each answer.
              </p>
              {/* RAG vertical diagram */}
              <div className="ragPipeline">
                {[
                  { label: 'Document Ingestion', desc: 'PDF, DOCX, TXT parsed via FastAPI', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12' },
                  { label: 'Text Chunking', desc: 'LangChain recursive character splitter', icon: 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16' },
                  { label: 'Vector Embeddings', desc: 'OpenAI text-embedding-ada-002', icon: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
                  { label: 'Semantic Search', desc: 'PostgreSQL + pgvector cosine similarity', icon: 'M11 11a7 7 0 100-14 7 7 0 000 14zM21 21l-4.35-4.35' },
                  { label: 'LLM Generation', desc: 'GPT-4o-mini with retrieved context', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM8 12h8M12 8v8' },
                  { label: 'Citation Mapping', desc: 'Traceable page & section references', icon: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71' },
                ].map((step, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <div className="ragConnector"><div className="ragConnectorGlow" /></div>}
                    <div className="ragNode">
                      <div className="ragNodeIcon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={step.icon}/></svg>
                      </div>
                      <div>
                        <div className="ragNodeLabel">{step.label}</div>
                        <div className="ragNodeDesc">{step.desc}</div>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="proRetrievalRight reveal">
              <h3 className="ragExplainTitle">Why RAG instead of fine-tuning?</h3>
              <p className="ragExplainText">
                Retrieval-Augmented Generation grounds every answer in real document content,
                preventing hallucinations that plague fine-tuned models. Instead of memorizing
                training data, IntelliDocs retrieves the most relevant passages at query time
                and passes them as context to the language model.
              </p>
              <p className="ragExplainText">
                This approach ensures answers are always traceable, up-to-date with the latest
                uploaded documents, and verifiable through direct citations.
              </p>
              <div className="ragStackTags">
                <span>FastAPI</span><span>React</span><span>PostgreSQL</span>
                <span>pgvector</span><span>LangChain</span><span>OpenAI GPT-4o-mini</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust Bar (compact credibility) ── */}
      <section className="proTrustBar">
        <div className="proTrustBarInner reveal">
          {[
            {
              icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
              title: 'Secure document handling',
              desc: 'Uploaded files remain isolated and processed securely.',
            },
            {
              icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
              title: 'Grounded answers',
              desc: 'Responses are generated only from retrieved document evidence.',
            },
            {
              icon: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
              title: 'Citation transparency',
              desc: 'Each answer includes traceable references to source pages.',
            },
            {
              icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
              title: 'Fast retrieval',
              desc: 'Relevant passages are matched quickly for responsive interaction.',
            },
          ].map((item, i) => (
            <div key={i} className="trustBarCard reveal-child">
              <div className="trustBarIcon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon}/></svg>
              </div>
              <h4 className="trustBarTitle">{item.title}</h4>
              <p className="trustBarDesc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust section ── */}
      <section className="proTrust">
        <div className="proTrustInner">
          <div className="proTrustGrid">
            <div className="proTrustContent reveal">
              <h2>Accurate answers grounded in your documents</h2>
              <p>
                IntelliDocs uses retrieval-based document intelligence to generate
                grounded answers directly from your files. No hallucinations,
                no guesswork — every response is traceable to its source.
              </p>
              <div className="proTrustList">
                <div className="proTrustItem">
                  <div className="proTrustItemIcon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg></div>
                  <div><h4>Verifiable citations</h4><p>Every response links to the exact page and section in your source document.</p></div>
                </div>
                <div className="proTrustItem">
                  <div className="proTrustItemIcon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>
                  <div><h4>Secure document handling</h4><p>Your files stay in your workspace. Documents are processed securely and never shared.</p></div>
                </div>
                <div className="proTrustItem">
                  <div className="proTrustItemIcon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
                  <div><h4>Fast retrieval</h4><p>Get answers in seconds across documents that would take hours to read manually.</p></div>
                </div>
              </div>
            </div>
            <div className="proTrustMetrics reveal">
              <div className="proTrustMetric">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h7M7 16h4"/></svg>
                <div className="proTrustMetricText"><div className="proTrustMetricValue">3 formats</div><div className="proTrustMetricLabel">PDF, DOCX, TXT</div></div>
              </div>
              <div className="proTrustMetric">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <div className="proTrustMetricText"><div className="proTrustMetricValue">&lt;5s response</div><div className="proTrustMetricLabel">Average retrieval time</div></div>
              </div>
              <div className="proTrustMetric">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                <div className="proTrustMetricText"><div className="proTrustMetricValue">Source-linked</div><div className="proTrustMetricLabel">Every answer cites its origin</div></div>
              </div>
              <div className="proTrustMetric">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                <div className="proTrustMetricText"><div className="proTrustMetricValue">Private access</div><div className="proTrustMetricLabel">Documents stay in your workspace</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Architecture Diagram ── */}
      <section id="section-architecture" className="proArch">
        <div className="proArchInner">
          <h2 className="proArchTitle reveal">System architecture</h2>
          <p className="proArchSub reveal">Four interconnected modules, each responsible for a stage of the document intelligence pipeline.</p>
          <div className="archFlow reveal">
            {archModules.map((mod, mi) => (
              <React.Fragment key={mod.label}>
                {mi > 0 && (
                  <div className="archFlowLine">
                    <div className="archFlowLineInner" />
                    <div className="archFlowGlow" />
                  </div>
                )}
                <div className="archCol" style={{ '--mod-color': mod.color }}>
                  <div className="archColHead">{mod.label}</div>
                  <div className="archColNodes">
                    {mod.children.map((ch) => (
                      <div key={ch.name} className="archChild reveal-child">
                        <div className="archChildName">{ch.name}</div>
                        <div className="archChildDetail">{ch.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ── Academic References ── */}
      <section id="section-references" className="proRefs">
        <div className="proRefsInner">
          <h2 className="proRefsTitle reveal">Research foundations</h2>
          <div className="proRefsList reveal">
            {[
              { authors: 'Lewis et al.', title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', venue: 'NeurIPS 2020, arXiv:2005.11401' },
              { authors: 'Chase, H.', title: 'LangChain: Building Applications with LLMs through Composability', venue: '2023' },
              { authors: 'pgvector contributors', title: 'pgvector: Open-Source Vector Similarity Search for PostgreSQL', venue: 'GitHub' },
              { authors: 'OpenAI', title: 'GPT-4 Technical Report', venue: 'arXiv:2303.08774, 2023' },
              { authors: 'Neelakantan et al.', title: 'Text and Code Embeddings by Contrastive Pre-Training', venue: 'arXiv:2201.10005, 2022' },
              { authors: 'Ram\u00edrez, S.', title: 'FastAPI: Modern, Fast Web Framework for Building APIs with Python', venue: '2023' },
            ].map((ref, i) => (
              <div key={i} className="proRefEntry reveal-child">
                <span className="proRefAuthors">{ref.authors}</span>
                <span className="proRefTitle">{ref.title}.</span>{' '}
                <span className="proRefVenue">{ref.venue}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="proFinalCta">
        <div className="proFinalCtaInner reveal">
          <h2>Ready to understand your documents better?</h2>
          <p>Start with a lightweight workspace. Upgrade to a full account whenever you need.</p>
          <div className="proFinalActions">
            <button className="proBtnPrimary proBtnLg" onClick={onNavigateToAuth}>
              Create free account
              <span className="proBtnArrow">&rarr;</span>
            </button>
            <button className="proBtnGhost proBtnLg" onClick={enterAsGuest}>Try as guest</button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="proFooter">
        <div className="proFooterInner">
          <div className="proFooterBrand">
            <div className="proLogo">
              <span className="proLogoMark">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="1" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M6 18h10a2 2 0 002-2V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M6 6h5M6 9h7M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
              <span className="proLogoText">IntelliDocs</span>
            </div>
            <p>Document assistant with traceable answers and enterprise-grade design.</p>
          </div>
          <div className="proFooterCols">
            <div>
              <h4>Product</h4>
              <span onClick={() => scrollToSection('section-features')}>Features</span>
              <span onClick={() => scrollToSection('section-demo')}>Demo</span>
            </div>
            <div>
              <h4>Support</h4>
              <span onClick={() => scrollToSection('section-references')}>Documentation</span>
              <span onClick={() => setLegalModal('contact')}>Contact</span>
            </div>
            <div>
              <h4>Legal</h4>
              <span onClick={() => setLegalModal('privacy')}>Privacy</span>
              <span onClick={() => setLegalModal('terms')}>Terms</span>
            </div>
          </div>
          <div className="proFooterBottom">
            <span>&copy; 2026 IntelliDocs. All rights reserved.</span>
          </div>
        </div>
      </footer>

      {/* ── Legal Modal ── */}
      {legalModal && (
        <div className="legalOverlay" onClick={() => setLegalModal(null)}>
          <div className="legalModal" onClick={(e) => e.stopPropagation()}>
            <div className="legalHeader">
              <h2>{legalModal === 'privacy' ? 'Privacy Policy' : legalModal === 'terms' ? 'Terms of Service' : 'Contact'}</h2>
              <button className="legalClose" onClick={() => setLegalModal(null)}>&times;</button>
            </div>
            <div className="legalBody">
              {legalModal === 'privacy' ? (
                <>
                  <p><strong>Effective Date:</strong> March 2026</p>
                  <p>IntelliDocs is a capstone project developed for academic purposes at the Polytechnic University of Puerto Rico. This application processes documents uploaded by users to provide AI-powered question answering with citations.</p>
                  <h3>Data Collection</h3>
                  <p>We collect only the information necessary to provide the service: email addresses for authentication and uploaded documents for processing. Documents are stored securely and are accessible only to the uploading user.</p>
                  <h3>Data Usage</h3>
                  <p>Uploaded documents are processed through our retrieval-augmented generation pipeline to generate answers. Document content is sent to third-party AI providers (OpenAI) for embedding generation and answer synthesis.</p>
                  <h3>Data Retention</h3>
                  <p>Users may delete their documents at any time. Account data is retained only for the duration of the project demonstration period.</p>
                  <h3>Contact</h3>
                  <p>For privacy-related inquiries, please contact the project team through the Polytechnic University of Puerto Rico, Department of Computer Science.</p>
                </>
              ) : legalModal === 'terms' ? (
                <>
                  <p><strong>Effective Date:</strong> March 2026</p>
                  <p>By using IntelliDocs, you agree to the following terms. This application is provided as-is for academic demonstration purposes.</p>
                  <h3>Acceptable Use</h3>
                  <p>IntelliDocs is designed for document question-answering. Users should not upload sensitive, confidential, or classified documents. The service is intended for demonstration and educational purposes.</p>
                  <h3>Service Limitations</h3>
                  <p>IntelliDocs uses AI-generated responses grounded in uploaded documents. While answers include citations, they should not be treated as legal, medical, or professional advice. Always verify critical information against original sources.</p>
                  <h3>Guest Access</h3>
                  <p>Guest users have limited access to the platform. Document uploads and questions are restricted. Create an account for expanded access.</p>
                  <h3>Intellectual Property</h3>
                  <p>Users retain ownership of all uploaded documents. IntelliDocs does not claim any rights over user-uploaded content.</p>
                  <h3>Disclaimer</h3>
                  <p>This is an academic capstone project. The service may be discontinued after the project evaluation period. No guarantees of uptime or data persistence are provided.</p>
                </>
              ) : (
                <>
                  <h3>Project</h3>
                  <p>CS 4022 — Capstone Project</p>
                  <h3>Institution</h3>
                  <p>Polytechnic University of Puerto Rico<br/>Department of Computer Science &amp; Engineering</p>
                  <h3>Repository</h3>
                  <p><a href="https://github.com" target="_blank" rel="noopener noreferrer" className="legalLink">github.com/intellidocs</a></p>
                  <h3>Academic Inquiries</h3>
                  <p>For academic inquiries or feedback, contact the project team through the Polytechnic University of Puerto Rico.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
