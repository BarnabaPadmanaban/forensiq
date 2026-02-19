import { useState, useRef, useEffect, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/* ══════════════════════════════════════════════════════
   OLLAMA API
══════════════════════════════════════════════════════ */
async function callAI(systemPrompt, userPrompt) {
  const res = await fetch("http://localhost:3001/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, prompt: userPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Server error ${res.status}`);
  }
  const d = await res.json();
  return d.text || "";
}

/* ══════════════════════════════════════════════════════
   FILE TEXT EXTRACTOR — handles PDF + text files
══════════════════════════════════════════════════════ */
async function extractTextFromFile(file) {
  const isPDF = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPDF) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(" ");
      fullText += pageText + "\n";
    }
    return fullText.trim();
  } else {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result || "");
      reader.onerror = () => resolve("");
      reader.readAsText(file);
    });
  }
}

/* ══════════════════════════════════════════════════════
   ROBUST JSON EXTRACTOR
══════════════════════════════════════════════════════ */
function extractJSON(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response");
  s = s.slice(start);
  try { return JSON.parse(s); } catch (_) {}
  const opens = [];
  let inStr = false, escape = false;
  for (const c of s) {
    if (escape) { escape = false; continue; }
    if (c === "\\" && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") opens.push("}");
    else if (c === "[") opens.push("]");
    else if (c === "}" || c === "]") opens.pop();
  }
  const repaired = s + opens.reverse().join("");
  try { return JSON.parse(repaired); }
  catch (e) { throw new Error("JSON parse failed: " + e.message); }
}

/* ══════════════════════════════════════════════════════
   COLOUR HELPERS
══════════════════════════════════════════════════════ */
const pctCol  = n => n >= 70 ? "#ff5f5f" : n >= 40 ? "#ffaa44" : "#94a3b8";
const sevCol  = s => s === "HIGH" ? "#ff5f5f" : s === "MEDIUM" ? "#ffaa44" : "#4ade80";
const priCol  = p => p === "HIGH" ? "#ff5f5f" : p === "MEDIUM" ? "#ffaa44" : "#4ade80";
const credCol = n => n >= 70 ? "#4ade80" : n >= 40 ? "#ffaa44" : "#ff5f5f";

/* ══════════════════════════════════════════════════════
   MICRO COMPONENTS
══════════════════════════════════════════════════════ */
const Pulse = ({ color = "#c9a96e" }) => (
  <span style={{ display:"inline-flex", gap:5, alignItems:"center", verticalAlign:"middle", marginRight:8 }}>
    {[0,1,2].map(i => (
      <span key={i} style={{
        width:7, height:7, borderRadius:"50%", background:color,
        animation:`pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        display:"inline-block",
      }} />
    ))}
  </span>
);

function GlassCard({ children, style = {}, glow }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.028)",
      border: `1px solid ${glow ? glow + "35" : "rgba(201,169,110,0.13)"}`,
      borderRadius: 16,
      backdropFilter: "blur(14px)",
      boxShadow: glow
        ? `0 0 32px ${glow}12, inset 0 1px 0 rgba(255,255,255,0.06)`
        : "inset 0 1px 0 rgba(255,255,255,0.04)",
      ...style,
    }}>{children}</div>
  );
}

function SectionLabel({ icon, text, color = "#c9a96e" }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
      <span style={{ fontSize:15 }}>{icon}</span>
      <span style={{ fontSize:10, letterSpacing:3, color, textTransform:"uppercase", fontFamily:"'Courier New',monospace" }}>{text}</span>
      <div style={{ flex:1, height:1, background:`linear-gradient(90deg,${color}44,transparent)` }} />
    </div>
  );
}

function BarMeter({ value, color }) {
  return (
    <div style={{ height:6, background:"rgba(255,255,255,0.06)", borderRadius:99, overflow:"hidden" }}>
      <div style={{
        height:"100%", borderRadius:99,
        background: `linear-gradient(90deg,${color}99,${color})`,
        width: `${value}%`,
        boxShadow: `0 0 8px ${color}66`,
        transition: "width 1.5s cubic-bezier(.22,1,.36,1)",
      }} />
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span style={{
      padding:"3px 11px", borderRadius:99,
      background: `${color}18`, border: `1px solid ${color}44`,
      color, fontSize:9, fontFamily:"'Courier New',monospace", letterSpacing:2, whiteSpace:"nowrap",
    }}>{label}</span>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════ */
export default function ForensIQ() {

  const [tab, setTab]             = useState("analyze");
  const [file, setFile]           = useState(null);
  const [fileText, setFileText]   = useState("");
  const [drag, setDrag]           = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis]   = useState(null);
  const [anaErr, setAnaErr]       = useState("");

  const [chatOn, setChatOn]           = useState(false);
  const [genQs, setGenQs]             = useState(false);
  const [questions, setQuestions]     = useState([]);
  const [qIdx, setQIdx]               = useState(0);
  const [answers, setAnswers]         = useState([]);
  const [input, setInput]             = useState("");
  const [msgs, setMsgs]               = useState([]);
  const [showTyping, setShowTyping]   = useState(false);
  const [loadV, setLoadV]             = useState(false);
  const [verdict, setVerdict]         = useState(null);
  const [vErr, setVErr]               = useState("");
  const chatRef = useRef(null);

  useEffect(() => {
    chatRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [msgs, verdict, showTyping, genQs]);

  /* ── Load file — supports PDF + text */
  const loadFile = async (f) => {
    setFile(f); setAnalysis(null); setAnaErr(""); setFileText("");
    setExtracting(true);
    try {
      const text = await extractTextFromFile(f);
      setFileText(text);
    } catch (e) {
      setAnaErr("Could not read file: " + e.message);
    }
    setExtracting(false);
  };

  /* ── Analyze report */
  const analyze = async () => {
    if (!fileText.trim()) {
      setAnaErr("File appears empty or could not be read. Try a .txt or .pdf file.");
      return;
    }
    setAnalyzing(true); setAnaErr(""); setAnalysis(null);
    try {
      const systemPrompt = `You are a world-class forensic analyst and criminal psychologist with 30 years of experience.
Analyze forensic reports with extreme precision and accuracy.
CRITICAL RULE: Respond with ONLY a valid JSON object. No markdown fences, no explanation text, no comments.
Keep every string value concise. Max 80 chars per reasoning field.`;

      const userPrompt = `Analyze this forensic report and return ONLY this exact JSON:
{
  "crime_probabilities": [
    {"crime": "Murder", "percentage": 85, "reasoning": "Short explanation max 80 chars"},
    {"crime": "Assault", "percentage": 55, "reasoning": "Short explanation max 80 chars"},
    {"crime": "Robbery", "percentage": 25, "reasoning": "Short explanation max 80 chars"}
  ],
  "what_happened": "2-3 paragraph detailed crime reconstruction. Max 600 chars.",
  "key_evidence": ["Evidence point 1", "Evidence point 2", "Evidence point 3", "Evidence point 4"],
  "victim_profile": "Brief victim profile. Max 200 chars.",
  "perpetrator_profile": "Forensic psychological profile of likely perpetrator. Max 200 chars.",
  "motive_analysis": "Likely motive based on forensic evidence. Max 150 chars.",
  "severity": "HIGH",
  "confidence_score": 78
}

FORENSIC REPORT:
${fileText.slice(0, 4000)}`;

      const raw = await callAI(systemPrompt, userPrompt);
      setAnalysis(extractJSON(raw));
    } catch (e) {
      setAnaErr(e.message);
    }
    setAnalyzing(false);
  };

  /* ── Start prosecution interview */
  const startChat = async () => {
    setChatOn(true);
    setQIdx(0); setAnswers([]); setInput(""); setVerdict(null); setVErr("");
    setMsgs([{ role:"sys", text:"Reading your forensic report carefully and preparing case-specific questions…" }]);
    setGenQs(true);

    try {
      const systemPrompt = `You are a senior prosecutor with 25 years of criminal law experience.
Read forensic reports and generate highly targeted interview questions based on specific details.
CRITICAL RULE: Respond with ONLY valid JSON. No markdown, no preamble, no extra text.`;

      const userPrompt = `Read this forensic report carefully. Generate exactly 8 prosecution interview questions that directly reference specific names, locations, evidence, timelines, wounds, weapons, and circumstances found in THIS document. Questions must be case-specific, not generic.

Return ONLY this JSON:
{
  "case_summary": "One sentence describing this specific case. Max 120 chars.",
  "questions": [
    {"q": "Specific question referencing actual detail from report", "icon": "🔍", "focus": "What this probes. Max 35 chars."},
    {"q": "Specific question about timeline or last contact", "icon": "📅", "focus": "Timeline"},
    {"q": "Specific question about people mentioned in report", "icon": "👤", "focus": "Persons involved"},
    {"q": "Specific question about location mentioned in report", "icon": "📍", "focus": "Location"},
    {"q": "Specific question about victim state or behaviour", "icon": "🧠", "focus": "Victim behaviour"},
    {"q": "Specific question about witnesses or bystanders", "icon": "👁️", "focus": "Witnesses"},
    {"q": "Specific question about threats or motive from report", "icon": "⚠️", "focus": "Threats and motive"},
    {"q": "Specific question about suspect alibi or movements", "icon": "⚖️", "focus": "Alibi"}
  ]
}

FORENSIC REPORT:
${fileText.slice(0, 4500)}`;

      const raw = await callAI(systemPrompt, userPrompt);
      const parsed = extractJSON(raw);
      const qs = parsed.questions || [];
      if (qs.length === 0) throw new Error("No questions generated");

      setQuestions(qs);
      setGenQs(false);
      setMsgs([
        { role:"sys", text: parsed.case_summary
            ? `📋 Case loaded: "${parsed.case_summary}"\n\nI have studied the forensic report and prepared ${qs.length} targeted questions. Answer each fully and honestly.`
            : `📋 Forensic report analysed. ${qs.length} case-specific questions prepared.` },
        { role:"pro", text: qs[0].q, icon: qs[0].icon, focus: qs[0].focus },
      ]);
    } catch (e) {
      setGenQs(false);
      const fallback = [
        { q:"What is your relationship to the victim and how long have you known them?", icon:"🤝", focus:"Relationship" },
        { q:"When was the last time you physically met or saw the victim?", icon:"📅", focus:"Last contact" },
        { q:"What was the victim wearing during your last encounter?", icon:"👗", focus:"Physical details" },
        { q:"Describe the victim's emotional state during that last meeting.", icon:"🧠", focus:"Victim state" },
        { q:"Where exactly did your last meeting with the victim take place?", icon:"📍", focus:"Location" },
        { q:"Were there any witnesses present at your last meeting?", icon:"👁️", focus:"Witnesses" },
        { q:"Did the victim mention any threats, fears, or enemies recently?", icon:"⚠️", focus:"Threats" },
        { q:"Describe your own movements and activities at the time of the incident.", icon:"🕐", focus:"Alibi" },
      ];
      setQuestions(fallback);
      setMsgs([
        { role:"sys", text:`⚠️ Could not generate document-specific questions (${e.message}). Using standard protocol.` },
        { role:"pro", text:fallback[0].q, icon:fallback[0].icon, focus:fallback[0].focus },
      ]);
    }
  };

  /* ── Submit answer */
  const submitAnswer = useCallback(async () => {
    if (!input.trim() || loadV || genQs || questions.length === 0) return;
    const ans = input.trim();
    const newAns = [...answers, { q: questions[qIdx].q, a: ans }];
    setAnswers(newAns); setInput("");
    const withUser = [...msgs, { role:"user", text:ans }];
    setMsgs(withUser);

    if (qIdx < questions.length - 1) {
      setShowTyping(true);
      await new Promise(r => setTimeout(r, 900));
      setShowTyping(false);
      const next = qIdx + 1;
      setQIdx(next);
      setMsgs([...withUser, { role:"pro", text:questions[next].q, icon:questions[next].icon, focus:questions[next].focus }]);
    } else {
      setMsgs([...withUser, { role:"sys", text:"All responses recorded. Cross-referencing with forensic evidence…" }]);
      setLoadV(true); setVErr("");
      try {
        const qa = newAns.map((x, i) => `Q${i+1}: ${x.q}\nAnswer: ${x.a}`).join("\n\n");
        const systemPrompt = `You are a senior prosecutor and forensic legal advisor.
Cross-reference interview responses against forensic evidence.
CRITICAL RULE: Respond with ONLY valid JSON. No markdown, no preamble.`;

        const userPrompt = `Analyze this prosecution interview in context of the forensic report. Return ONLY this JSON:
{
  "case_context": "One sentence identifying the specific case. Max 120 chars.",
  "psychological_assessment": "Assessment of credibility and psychological state. Max 320 chars.",
  "timeline_reconstruction": "Chronological timeline using both forensic evidence AND interview answers. Max 350 chars.",
  "suspicious_elements": ["Specific inconsistency 1","Specific inconsistency 2","Specific red flag 3"],
  "credibility_score": 65,
  "evidence_contradictions": ["Contradiction between answer and forensic evidence 1","Contradiction 2"],
  "legal_recommendations": [
    {"action": "File FIR at Police Station", "priority": "HIGH", "description": "Specific guidance for this case. Max 150 chars."},
    {"action": "Preserve Key Evidence", "priority": "HIGH", "description": "Specific evidence to secure. Max 150 chars."},
    {"action": "Engage Criminal Lawyer", "priority": "MEDIUM", "description": "Legal avenue for this crime type. Max 150 chars."}
  ],
  "next_steps": "3-4 concrete actionable steps to seek justice. Max 450 chars.",
  "overall_verdict": "Final prosecution assessment integrating report and interview. Max 350 chars."
}

FORENSIC REPORT (first 2000 chars):
${fileText.slice(0, 2000)}

INTERVIEW TRANSCRIPT:
${qa}`;

        const raw = await callAI(systemPrompt, userPrompt);
        setVerdict(extractJSON(raw));
      } catch (e) { setVErr(e.message); }
      setLoadV(false);
    }
  }, [input, answers, qIdx, msgs, loadV, genQs, questions, fileText]);

  /* ══════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════ */
  return (
    <div style={{ minHeight:"100vh", background:"#060810", color:"#e2d9cc", fontFamily:"'Georgia','Times New Roman',serif", overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
        @keyframes pulse   { 0%,100%{transform:scaleY(.35);opacity:.35} 50%{transform:scaleY(1);opacity:1} }
        @keyframes glow    { 0%,100%{opacity:.55} 50%{opacity:1} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        .tab-btn:hover     { color:#e2d9cc !important; background:rgba(201,169,110,.07) !important; }
        .upload-zone:hover { border-color:rgba(201,169,110,.55) !important; background:rgba(201,169,110,.045) !important; }
        .gold-btn:hover:not(:disabled) { background:rgba(201,169,110,.28) !important; box-shadow:0 0 28px rgba(201,169,110,.22) !important; }
        .ghost-btn:hover   { background:rgba(201,169,110,.1) !important; color:#c9a96e !important; }
        textarea           { outline:none !important; }
        textarea:focus     { border-color:rgba(201,169,110,.5) !important; box-shadow:0 0 0 3px rgba(201,169,110,.08) !important; }
        ::-webkit-scrollbar       { width:5px }
        ::-webkit-scrollbar-thumb { background:rgba(201,169,110,.2); border-radius:99px }
        * { box-sizing:border-box }
      `}</style>

      {/* Atmospheric BG */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 70% 55% at 8% 50%,rgba(180,90,20,.06),transparent 60%)" }} />
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 55% 70% at 92% 18%,rgba(180,30,30,.04),transparent 60%)" }} />
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 60% 60% at 50% 100%,rgba(20,20,80,.28),transparent 70%)" }} />
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(201,169,110,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(201,169,110,.022) 1px,transparent 1px)", backgroundSize:"64px 64px" }} />
      </div>

      {/* HEADER */}
      <header style={{ position:"relative", zIndex:10, borderBottom:"1px solid rgba(201,169,110,.12)", background:"rgba(6,8,16,.85)", backdropFilter:"blur(20px)", padding:"0 44px" }}>
        <div style={{ maxWidth:1120, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:68 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:44, height:44, borderRadius:11, background:"linear-gradient(135deg,rgba(201,169,110,.24),rgba(201,169,110,.07))", border:"1px solid rgba(201,169,110,.32)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, boxShadow:"0 0 22px rgba(201,169,110,.1)" }}>🔬</div>
            <div>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:20, fontWeight:600, letterSpacing:2, color:"#e2d9cc", lineHeight:1 }}>ForensIQ</div>
              <div style={{ fontSize:9, letterSpacing:4, color:"#c9a96e", textTransform:"uppercase", marginTop:4, fontFamily:"'Courier New',monospace" }}>Crime Analysis Platform</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 9px #4ade80", animation:"glow 2s ease-in-out infinite" }} />
            <span style={{ fontSize:10, color:"#4ade80", fontFamily:"'Courier New',monospace", letterSpacing:1 }}>SYSTEM ONLINE</span>
          </div>
        </div>
      </header>

      {/* TABS */}
      <div style={{ position:"relative", zIndex:10, borderBottom:"1px solid rgba(201,169,110,.1)", background:"rgba(6,8,16,.65)", backdropFilter:"blur(10px)" }}>
        <div style={{ maxWidth:1120, margin:"0 auto", display:"flex", padding:"0 44px" }}>
          {[
            { id:"analyze", icon:"📄", label:"Forensic Analysis",     sub:"Upload & analyze report" },
            { id:"chat",    icon:"⚖️",  label:"Prosecution Interview", sub:"Document-aware AI prosecutor" },
          ].map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? "rgba(201,169,110,.08)" : "none",
              border:"none", cursor:"pointer", padding:"15px 26px",
              color: tab === t.id ? "#e2d9cc" : "#555",
              borderBottom: tab === t.id ? "2px solid #c9a96e" : "2px solid transparent",
              fontFamily:"'EB Garamond',serif", fontSize:15, letterSpacing:.5, transition:"all .2s",
              display:"flex", flexDirection:"column", alignItems:"flex-start",
            }}>
              <span>{t.icon} {t.label}</span>
              <span style={{ fontSize:10, color: tab === t.id ? "#c9a96e" : "#333", marginTop:2, fontFamily:"'Courier New',monospace", letterSpacing:1 }}>{t.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MAIN */}
      <main style={{ position:"relative", zIndex:10, maxWidth:1120, margin:"0 auto", padding:"40px 44px 90px" }}>

        {/* ════ ANALYZE TAB ════ */}
        {tab === "analyze" && (
          <div style={{ animation:"fadeUp .5s ease both" }}>

            {/* Upload Zone */}
            <GlassCard style={{ marginBottom:26 }}>
              <div
                className="upload-zone"
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); }}
                onClick={() => document.getElementById("fi").click()}
                style={{ border:`2px dashed ${drag ? "#c9a96e" : "rgba(201,169,110,.2)"}`, borderRadius:14, padding:"46px 32px", textAlign:"center", background:drag ? "rgba(201,169,110,.05)" : "transparent", transition:"all .3s", cursor:"pointer", margin:4 }}
              >
                <input id="fi" type="file" hidden
                  onChange={e => e.target.files[0] && loadFile(e.target.files[0])}
                  accept=".txt,.pdf,.doc,.docx,.rtf,.csv,.json,.log,.md"
                />
                {extracting ? (
                  <div>
                    <div style={{ marginBottom:12 }}><Pulse /></div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:14, color:"#c9a96e" }}>EXTRACTING TEXT FROM PDF…</div>
                  </div>
                ) : file ? (
                  <div style={{ animation:"fadeIn .3s ease" }}>
                    <div style={{ fontSize:42, marginBottom:10 }}>✅</div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:17, color:"#c9a96e", marginBottom:6 }}>{file.name}</div>
                    <div style={{ fontSize:12, color:"#555", fontFamily:"'Courier New',monospace" }}>
                      {(file.size / 1024).toFixed(1)} KB · {fileText.length.toLocaleString()} characters extracted · click to replace
                    </div>
                    {file.name.toLowerCase().endsWith(".pdf") && (
                      <div style={{ marginTop:8, fontSize:11, color:"#4ade80", fontFamily:"'Courier New',monospace" }}>✓ PDF text extracted successfully</div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:50, marginBottom:14, opacity:.65 }}>📂</div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:18, color:"#c9a96e", marginBottom:8 }}>Drop Forensic Report Here</div>
                    <div style={{ fontSize:12, color:"#444", fontFamily:"'Courier New',monospace", letterSpacing:.5 }}>
                      PDF · TXT · DOC · DOCX · RTF · CSV · JSON · LOG
                    </div>
                    <div style={{ marginTop:8, fontSize:11, color:"#555", fontFamily:"'Courier New',monospace" }}>
                      PDF files are fully supported ✓
                    </div>
                  </div>
                )}
              </div>
            </GlassCard>

            {file && !extracting && !analyzing && !analysis && fileText && (
              <div style={{ textAlign:"center", marginBottom:34 }}>
                <button className="gold-btn" onClick={analyze} style={{ background:"rgba(201,169,110,.14)", border:"1px solid rgba(201,169,110,.4)", color:"#e2d9cc", padding:"14px 52px", borderRadius:10, fontSize:14, cursor:"pointer", fontFamily:"'Cinzel',serif", letterSpacing:2, transition:"all .3s" }}>
                  🔬 ANALYZE REPORT
                </button>
              </div>
            )}

            {analyzing && (
              <GlassCard style={{ padding:"48px 32px", textAlign:"center", marginBottom:26 }}>
                <div style={{ marginBottom:14 }}><Pulse /></div>
                <div style={{ color:"#c9a96e", fontFamily:"'Cinzel',serif", letterSpacing:2, fontSize:13 }}>ANALYZING FORENSIC EVIDENCE…</div>
                <div style={{ fontSize:11, color:"#3a3a3a", marginTop:10, fontFamily:"'Courier New',monospace" }}>Processing report · Identifying patterns · Building crime profile</div>
              </GlassCard>
            )}

            {anaErr && (
              <GlassCard glow="#ff5f5f" style={{ padding:"20px 24px", marginBottom:22 }}>
                <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <span style={{ fontSize:20 }}>⚠️</span>
                  <div>
                    <div style={{ color:"#ff8080", fontFamily:"'Cinzel',serif", fontSize:12, letterSpacing:1, marginBottom:5 }}>ERROR</div>
                    <div style={{ color:"#cc8888", fontSize:13, fontFamily:"'Courier New',monospace" }}>{anaErr}</div>
                    <div style={{ color:"#555", fontSize:12, marginTop:6 }}>Make sure <code style={{ background:"rgba(255,255,255,.06)", padding:"1px 5px", borderRadius:4 }}>node server.cjs</code> is running.</div>
                  </div>
                </div>
              </GlassCard>
            )}

            {/* Analysis Results */}
            {analysis && (
              <div style={{ animation:"fadeUp .4s ease both" }}>
                <GlassCard glow={sevCol(analysis.severity)} style={{ padding:"26px 30px", marginBottom:20, position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", right:20, top:10, opacity:.05, fontSize:130, fontFamily:"'Cinzel',serif", fontWeight:700, color:"#fff", userSelect:"none", lineHeight:1 }}>{analysis.severity}</div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:14, position:"relative" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                      <div style={{ width:54, height:54, borderRadius:12, fontSize:24, background:`linear-gradient(135deg,${sevCol(analysis.severity)}33,${sevCol(analysis.severity)}10)`, border:`1px solid ${sevCol(analysis.severity)}44`, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 0 22px ${sevCol(analysis.severity)}22` }}>
                        {analysis.severity === "HIGH" ? "🚨" : analysis.severity === "MEDIUM" ? "⚠️" : "ℹ️"}
                      </div>
                      <div>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize:20, fontWeight:600, color:sevCol(analysis.severity), letterSpacing:2 }}>{analysis.severity} SEVERITY</div>
                        <div style={{ fontSize:11, color:"#555", fontFamily:"'Courier New',monospace", marginTop:3 }}>Forensic classification complete</div>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:46, fontWeight:700, color:"#c9a96e", lineHeight:1 }}>{analysis.confidence_score}<span style={{ fontSize:20 }}>%</span></div>
                      <div style={{ fontSize:9, color:"#555", fontFamily:"'Courier New',monospace", letterSpacing:2 }}>AI CONFIDENCE</div>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard style={{ padding:"26px 30px", marginBottom:18 }}>
                  <SectionLabel icon="📊" text="Crime Type Probabilities" />
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                    {analysis.crime_probabilities?.map((c, i) => (
                      <div key={i} style={{ padding:"16px 18px", background:"rgba(255,255,255,.025)", borderRadius:12, border:"1px solid rgba(255,255,255,.055)" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                          <div>
                            <div style={{ fontFamily:"'Cinzel',serif", fontSize:14, color:"#e2d9cc", marginBottom:4 }}>{c.crime}</div>
                            <div style={{ fontSize:11, color:"#666", fontFamily:"'Courier New',monospace" }}>{c.reasoning}</div>
                          </div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:26, fontWeight:700, color:pctCol(c.percentage), textShadow:`0 0 18px ${pctCol(c.percentage)}55`, minWidth:70, textAlign:"right" }}>{c.percentage}%</div>
                        </div>
                        <BarMeter value={c.percentage} color={pctCol(c.percentage)} />
                      </div>
                    ))}
                  </div>
                </GlassCard>

                <GlassCard style={{ padding:"26px 30px", marginBottom:18 }}>
                  <SectionLabel icon="🔎" text="Crime Reconstruction" />
                  <p style={{ color:"#c8b99a", lineHeight:1.9, fontSize:15, margin:0, fontFamily:"'EB Garamond',serif", fontStyle:"italic" }}>{analysis.what_happened}</p>
                </GlassCard>

                {analysis.motive_analysis && (
                  <GlassCard style={{ padding:"22px 28px", marginBottom:18 }}>
                    <SectionLabel icon="🧩" text="Motive Analysis" />
                    <p style={{ color:"#c8b99a", lineHeight:1.8, fontSize:14, margin:0, fontFamily:"'EB Garamond',serif" }}>{analysis.motive_analysis}</p>
                  </GlassCard>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:18 }}>
                  {[{ l:"Victim Profile", i:"👤", c:analysis.victim_profile }, { l:"Perpetrator Profile", i:"🎭", c:analysis.perpetrator_profile }].map(card => (
                    <GlassCard key={card.l} style={{ padding:"22px 24px" }}>
                      <SectionLabel icon={card.i} text={card.l} />
                      <p style={{ color:"#c8b99a", lineHeight:1.75, fontSize:13, margin:0, fontFamily:"'EB Garamond',serif" }}>{card.c}</p>
                    </GlassCard>
                  ))}
                </div>

                <GlassCard style={{ padding:"22px 28px", marginBottom:24 }}>
                  <SectionLabel icon="🔬" text="Key Evidence Points" />
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 24px" }}>
                    {analysis.key_evidence?.map((e, i) => (
                      <div key={i} style={{ display:"flex", gap:9, alignItems:"flex-start", fontSize:13, color:"#c8b99a", fontFamily:"'EB Garamond',serif" }}>
                        <span style={{ color:"#c9a96e", flexShrink:0, marginTop:1 }}>◆</span>{e}
                      </div>
                    ))}
                  </div>
                </GlassCard>

                <div style={{ textAlign:"center", padding:"26px", background:"linear-gradient(135deg,rgba(201,169,110,.07),rgba(201,169,110,.02))", borderRadius:16, border:"1px solid rgba(201,169,110,.18)" }}>
                  <div style={{ fontFamily:"'Cinzel',serif", color:"#c9a96e", fontSize:13, letterSpacing:1, marginBottom:6 }}>Analysis complete</div>
                  <div style={{ fontSize:13, color:"#666", fontFamily:"'EB Garamond',serif", marginBottom:18, fontStyle:"italic" }}>The AI prosecutor will study this report and generate targeted case-specific questions.</div>
                  <button className="gold-btn" onClick={() => setTab("chat")} style={{ background:"rgba(201,169,110,.16)", border:"1px solid rgba(201,169,110,.4)", color:"#e2d9cc", padding:"12px 38px", borderRadius:9, cursor:"pointer", fontFamily:"'Cinzel',serif", fontSize:13, letterSpacing:2, transition:"all .3s" }}>
                    BEGIN PROSECUTION INTERVIEW ⚖️
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ CHAT TAB ════ */}
        {tab === "chat" && (
          <div style={{ animation:"fadeUp .5s ease both" }}>
            {!chatOn ? (
              <div style={{ textAlign:"center", padding:"55px 20px" }}>
                <div style={{ width:88, height:88, borderRadius:22, background:"linear-gradient(135deg,rgba(201,169,110,.22),rgba(201,169,110,.05))", border:"1px solid rgba(201,169,110,.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, margin:"0 auto 26px", boxShadow:"0 0 44px rgba(201,169,110,.1)" }}>⚖️</div>
                <h2 style={{ fontFamily:"'Cinzel',serif", color:"#e2d9cc", fontWeight:600, fontSize:24, marginBottom:12, letterSpacing:2 }}>Prosecution Interview</h2>
                <div style={{ display:"inline-block", padding:"12px 22px", background:"rgba(201,169,110,.07)", border:"1px solid rgba(201,169,110,.22)", borderRadius:12, marginBottom:20 }}>
                  <div style={{ fontSize:11, fontFamily:"'Courier New',monospace", color:"#c9a96e", letterSpacing:2, marginBottom:4 }}>✦ DOCUMENT-AWARE AI ✦</div>
                  <div style={{ fontSize:13, color:"#b8a898", fontFamily:"'EB Garamond',serif", fontStyle:"italic" }}>AI reads your forensic report and generates questions<br />specific to the people, evidence, and events within it.</div>
                </div>
                {!fileText && (
                  <div style={{ background:"rgba(255,170,68,.07)", border:"1px solid rgba(255,170,68,.22)", borderRadius:10, padding:"12px 20px", marginBottom:22, display:"inline-block" }}>
                    <span style={{ color:"#ffaa44", fontSize:13, fontFamily:"'Courier New',monospace" }}>⚠ Upload a forensic report first in the Analysis tab.</span>
                  </div>
                )}
                <p style={{ color:"#666", maxWidth:500, margin:"0 auto 34px", lineHeight:1.9, fontSize:15, fontFamily:"'EB Garamond',serif", fontStyle:"italic" }}>
                  {fileText ? "Report detected. AI will craft 8 case-specific questions targeting gaps, inconsistencies, and critical details." : "You can still proceed with standard prosecution protocol questions."}
                </p>
                <button className="gold-btn" onClick={startChat} style={{ background:"rgba(201,169,110,.16)", border:"1px solid rgba(201,169,110,.4)", color:"#e2d9cc", padding:"14px 52px", borderRadius:10, cursor:"pointer", fontFamily:"'Cinzel',serif", fontSize:14, letterSpacing:3, transition:"all .3s" }}>
                  BEGIN INTERVIEW
                </button>
              </div>
            ) : (
              <div>
                {questions.length > 0 && (
                  <GlassCard style={{ padding:"16px 24px", marginBottom:18 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <div style={{ fontFamily:"'Courier New',monospace", fontSize:10, color:"#555", letterSpacing:2 }}>
                        QUESTION {Math.min(qIdx+1, questions.length)} OF {questions.length}
                        {questions[qIdx] && <span style={{ color:"#c9a96e", marginLeft:10 }}>· {questions[qIdx].focus}</span>}
                      </div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:12, color:"#c9a96e" }}>{Math.round((answers.length / questions.length) * 100)}% Complete</div>
                    </div>
                    <div style={{ display:"flex", gap:5 }}>
                      {questions.map((_, i) => (
                        <div key={i} style={{ flex:1, height:4, borderRadius:99, background: i < answers.length ? "#c9a96e" : i === qIdx ? "rgba(201,169,110,.4)" : "rgba(255,255,255,.06)", transition:"background .4s", boxShadow: i < answers.length ? "0 0 6px rgba(201,169,110,.4)" : "none" }} />
                      ))}
                    </div>
                  </GlassCard>
                )}

                <GlassCard style={{ padding:22, marginBottom:14, height:460, overflowY:"auto" }}>
                  {msgs.map((m, i) => (
                    <div key={i} style={{ display:"flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap:11, alignItems:"flex-start", marginBottom:16, animation:"fadeUp .3s ease both" }}>
                      <div style={{ width:38, height:38, borderRadius:10, flexShrink:0, background: m.role === "pro" ? "rgba(201,169,110,.2)" : m.role === "sys" ? "rgba(100,120,200,.2)" : "rgba(60,200,140,.18)", border:`1px solid ${m.role === "pro" ? "rgba(201,169,110,.3)" : m.role === "sys" ? "rgba(100,120,200,.3)" : "rgba(60,200,140,.3)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>
                        {m.role === "pro" ? (m.icon || "⚖️") : m.role === "sys" ? "🔔" : "👤"}
                      </div>
                      <div style={{ maxWidth:"76%", background: m.role === "user" ? "rgba(60,200,140,.07)" : m.role === "sys" ? "rgba(100,120,200,.07)" : "rgba(201,169,110,.07)", border:`1px solid ${m.role === "user" ? "rgba(60,200,140,.15)" : m.role === "sys" ? "rgba(100,120,200,.15)" : "rgba(201,169,110,.18)"}`, borderRadius:12, padding:"12px 16px", fontSize:14, color:"#d4c4a8", lineHeight:1.72, fontFamily:"'EB Garamond',serif" }}>
                        {m.role === "pro" && <div style={{ fontSize:9, letterSpacing:3, color:"#c9a96e", fontFamily:"'Courier New',monospace", marginBottom:6 }}>PROSECUTOR {m.focus && `· ${m.focus.toUpperCase()}`}</div>}
                        {m.role === "sys" && <div style={{ fontSize:9, letterSpacing:3, color:"#8899cc", fontFamily:"'Courier New',monospace", marginBottom:6 }}>SYSTEM</div>}
                        {m.text}
                      </div>
                    </div>
                  ))}

                  {genQs && (
                    <div style={{ display:"flex", gap:11, alignItems:"flex-start", marginBottom:16 }}>
                      <div style={{ width:38, height:38, borderRadius:10, background:"rgba(201,169,110,.18)", border:"1px solid rgba(201,169,110,.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>⚖️</div>
                      <div style={{ background:"rgba(201,169,110,.07)", border:"1px solid rgba(201,169,110,.18)", borderRadius:12, padding:"14px 18px" }}>
                        <div style={{ fontSize:9, letterSpacing:3, color:"#c9a96e", fontFamily:"'Courier New',monospace", marginBottom:8 }}>PROSECUTOR · READING REPORT</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, color:"#888", fontSize:13 }}>
                          <Pulse /><span style={{ fontFamily:"'EB Garamond',serif", fontStyle:"italic" }}>Analysing forensic evidence to prepare targeted questions…</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {showTyping && !genQs && (
                    <div style={{ display:"flex", gap:11, alignItems:"flex-start", marginBottom:14 }}>
                      <div style={{ width:38, height:38, borderRadius:10, background:"rgba(201,169,110,.18)", border:"1px solid rgba(201,169,110,.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>⚖️</div>
                      <div style={{ background:"rgba(201,169,110,.07)", border:"1px solid rgba(201,169,110,.18)", borderRadius:12, padding:"14px 20px" }}><Pulse /></div>
                    </div>
                  )}

                  {loadV && (
                    <div style={{ textAlign:"center", padding:"26px", color:"#666", fontSize:12, fontFamily:"'Courier New',monospace", letterSpacing:1 }}>
                      <Pulse /> CROSS-REFERENCING WITH FORENSIC EVIDENCE…
                    </div>
                  )}
                  <div ref={chatRef} />
                </GlassCard>

                {!genQs && answers.length < questions.length && !loadV && questions.length > 0 && (
                  <GlassCard style={{ padding:14 }}>
                    <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
                      <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitAnswer(); } }} placeholder="Type your answer… (Enter to submit · Shift+Enter for new line)" rows={3}
                        style={{ flex:1, background:"rgba(255,255,255,.04)", border:"1px solid rgba(201,169,110,.2)", borderRadius:10, padding:"12px 16px", color:"#e2d9cc", fontFamily:"'EB Garamond',serif", fontSize:15, resize:"none", lineHeight:1.6, transition:"border-color .2s, box-shadow .2s" }}
                      />
                      <button onClick={submitAnswer} disabled={!input.trim()} style={{ background: input.trim() ? "rgba(201,169,110,.22)" : "rgba(255,255,255,.04)", border:`1px solid ${input.trim() ? "rgba(201,169,110,.4)" : "rgba(255,255,255,.08)"}`, color: input.trim() ? "#e2d9cc" : "#444", padding:"0 26px", height:82, borderRadius:10, cursor: input.trim() ? "pointer" : "not-allowed", fontFamily:"'Cinzel',serif", fontSize:13, letterSpacing:1.5, transition:"all .2s", flexShrink:0 }}>SUBMIT<br />→</button>
                    </div>
                  </GlassCard>
                )}

                {vErr && (
                  <GlassCard glow="#ff5f5f" style={{ padding:"16px 20px", marginTop:14 }}>
                    <span style={{ fontSize:16, marginRight:8 }}>⚠️</span>
                    <span style={{ color:"#ff8888", fontSize:13, fontFamily:"'Courier New',monospace" }}>{vErr}</span>
                  </GlassCard>
                )}

                {verdict && (
                  <div style={{ marginTop:30, animation:"fadeUp .5s ease both" }}>
                    <div style={{ textAlign:"center", marginBottom:26 }}>
                      <div style={{ display:"inline-block", padding:"8px 28px", background:"rgba(201,169,110,.1)", border:"1px solid rgba(201,169,110,.25)", borderRadius:99, fontFamily:"'Courier New',monospace", fontSize:9, letterSpacing:4, color:"#c9a96e" }}>— PROSECUTION ANALYSIS REPORT —</div>
                      {verdict.case_context && <div style={{ marginTop:10, fontFamily:"'EB Garamond',serif", fontStyle:"italic", color:"#888", fontSize:14 }}>{verdict.case_context}</div>}
                    </div>

                    <GlassCard glow={credCol(verdict.credibility_score)} style={{ padding:"22px 28px", marginBottom:16 }}>
                      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:20 }}>
                        <div style={{ flex:1 }}>
                          <SectionLabel icon="🧠" text="Psychological Assessment" color={credCol(verdict.credibility_score)} />
                          <p style={{ color:"#c8b99a", fontSize:14, lineHeight:1.8, margin:0, fontFamily:"'EB Garamond',serif" }}>{verdict.psychological_assessment}</p>
                        </div>
                        <div style={{ textAlign:"center", flexShrink:0 }}>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:50, fontWeight:700, color:credCol(verdict.credibility_score), lineHeight:1, textShadow:`0 0 28px ${credCol(verdict.credibility_score)}55` }}>{verdict.credibility_score}</div>
                          <div style={{ fontSize:9, fontFamily:"'Courier New',monospace", letterSpacing:2, color:"#555", marginTop:4 }}>CREDIBILITY</div>
                        </div>
                      </div>
                    </GlassCard>

                    <GlassCard style={{ padding:"22px 28px", marginBottom:16 }}>
                      <SectionLabel icon="📅" text="Timeline Reconstruction" />
                      <p style={{ color:"#c8b99a", fontSize:14, lineHeight:1.85, margin:0, fontFamily:"'EB Garamond',serif", fontStyle:"italic" }}>{verdict.timeline_reconstruction}</p>
                    </GlassCard>

                    {verdict.evidence_contradictions?.length > 0 && (
                      <GlassCard glow="#ffaa44" style={{ padding:"20px 26px", marginBottom:16 }}>
                        <SectionLabel icon="🔍" text="Evidence Contradictions" color="#ffaa44" />
                        {verdict.evidence_contradictions.map((c, i) => (
                          <div key={i} style={{ display:"flex", gap:9, marginBottom:9, fontSize:14, color:"#c8b99a", fontFamily:"'EB Garamond',serif", alignItems:"flex-start" }}>
                            <span style={{ color:"#ffaa44", flexShrink:0, marginTop:2 }}>≠</span>{c}
                          </div>
                        ))}
                      </GlassCard>
                    )}

                    {verdict.suspicious_elements?.length > 0 && (
                      <GlassCard glow="#ff5f5f" style={{ padding:"20px 26px", marginBottom:16 }}>
                        <SectionLabel icon="⚠️" text="Suspicious Elements" color="#ff7f7f" />
                        {verdict.suspicious_elements.map((s, i) => (
                          <div key={i} style={{ display:"flex", gap:9, marginBottom:9, fontSize:14, color:"#c8b99a", fontFamily:"'EB Garamond',serif", alignItems:"flex-start" }}>
                            <span style={{ color:"#ff5f5f", flexShrink:0, marginTop:2 }}>⚑</span>{s}
                          </div>
                        ))}
                      </GlassCard>
                    )}

                    <GlassCard style={{ padding:"22px 28px", marginBottom:16 }}>
                      <SectionLabel icon="⚖️" text="Legal Recommendations" />
                      <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
                        {verdict.legal_recommendations?.map((r, i) => (
                          <div key={i} style={{ padding:"14px 18px", background:"rgba(255,255,255,.025)", borderRadius:10, borderLeft:`3px solid ${priCol(r.priority)}`, display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:14 }}>
                            <div>
                              <div style={{ fontFamily:"'Cinzel',serif", fontSize:13, color:"#e2d9cc", marginBottom:4 }}>{r.action}</div>
                              <div style={{ fontSize:13, color:"#888", fontFamily:"'EB Garamond',serif" }}>{r.description}</div>
                            </div>
                            <Badge label={r.priority} color={priCol(r.priority)} />
                          </div>
                        ))}
                      </div>
                    </GlassCard>

                    <GlassCard glow="#4ade80" style={{ padding:"22px 28px", marginBottom:16 }}>
                      <SectionLabel icon="🏛️" text="Path to Justice" color="#4ade80" />
                      <p style={{ color:"#c8b99a", fontSize:14, lineHeight:1.9, margin:0, fontFamily:"'EB Garamond',serif" }}>{verdict.next_steps}</p>
                    </GlassCard>

                    <GlassCard style={{ padding:"22px 28px", marginBottom:28 }}>
                      <SectionLabel icon="📋" text="Overall Prosecution Assessment" />
                      <p style={{ color:"#d4c4a8", fontSize:15, lineHeight:1.85, margin:0, fontFamily:"'EB Garamond',serif", fontStyle:"italic" }}>{verdict.overall_verdict}</p>
                    </GlassCard>

                    <div style={{ textAlign:"center" }}>
                      <button className="ghost-btn" onClick={() => { setChatOn(false); setVerdict(null); setQuestions([]); }} style={{ background:"none", border:"1px solid rgba(201,169,110,.2)", color:"#666", padding:"10px 28px", borderRadius:8, cursor:"pointer", fontFamily:"'Courier New',monospace", fontSize:10, letterSpacing:2, transition:"all .2s" }}>↺ NEW INTERVIEW</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer style={{ position:"relative", zIndex:10, textAlign:"center", padding:"18px", borderTop:"1px solid rgba(201,169,110,.07)", color:"#282828", fontSize:9, letterSpacing:3, fontFamily:"'Courier New',monospace" }}>
        FORENSIQ · DOCUMENT-AWARE PROSECUTION · EDUCATIONAL &amp; LEGAL AID USE ONLY
      </footer>
    </div>
  );
}
