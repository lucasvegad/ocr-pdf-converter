"use client";
import { useState, useRef, useCallback, useEffect } from "react";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar: ${src}`));
    document.head.appendChild(s);
  });
}

function canvasToBase64(canvas) {
  return canvas.toDataURL("image/png").split(",")[1];
}

async function callVisionOCR(base64Image, apiKey) {
  const body = {
    requests: [{
      image: { content: base64Image },
      features: [{ type: "TEXT_DETECTION" }],
      imageContext: { languageHints: ["es", "en"] }
    }]
  };
  const res = await fetch(`${VISION_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Vision API error ${res.status}: ${errData?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const annotations = data.responses?.[0]?.textAnnotations;
  if (!annotations || annotations.length === 0) return { fullText: "", words: [] };
  const words = annotations.slice(1).map((a) => ({
    text: a.description,
    vertices: a.boundingPoly?.vertices || [],
  }));
  return { fullText: annotations[0].description, words };
}

const STATUS = {
  IDLE: "idle", LOADING_LIBS: "loading_libs", READING_PDF: "reading_pdf",
  ANALYZING: "analyzing", OCR_PROCESSING: "ocr_processing",
  GENERATING_PDF: "generating_pdf", DONE: "done", ERROR: "error", CANCELLED: "cancelled",
};

const statusMessages = {
  [STATUS.LOADING_LIBS]: "Cargando librerías...",
  [STATUS.READING_PDF]: "Leyendo PDF...",
  [STATUS.ANALYZING]: "Analizando páginas...",
  [STATUS.OCR_PROCESSING]: "Procesando OCR con Google Vision...",
  [STATUS.GENERATING_PDF]: "Generando PDF searchable...",
  [STATUS.DONE]: "¡Listo!",
  [STATUS.ERROR]: "Error",
  [STATUS.CANCELLED]: "Cancelado",
};

// ─── Guide component ───
function ApiGuide({ onClose }) {
  const steps = [
    { n: "1", title: "Crear proyecto en Google Cloud", desc: "Andá a console.cloud.google.com y creá un proyecto nuevo (o usá uno existente). Es gratis." },
    { n: "2", title: "Activar Cloud Vision API", desc: "En el menú lateral → APIs y Servicios → Biblioteca. Buscá \"Cloud Vision API\" y hacé click en Habilitar." },
    { n: "3", title: "Crear API Key", desc: "Andá a APIs y Servicios → Credenciales → Crear credenciales → Clave de API. Copiá la clave generada." },
    { n: "4", title: "Pegar acá", desc: "Pegá tu API key en el campo de arriba. La clave NO se guarda en ningún servidor — solo se usa en tu navegador durante esta sesión." },
  ];

  return (
    <div style={{ background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: "'Space Grotesk', sans-serif", color: "#60a5fa" }}>
          📋 Cómo obtener tu API Key (gratis)
        </h3>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 18 }}>✕</button>
      </div>
      {steps.map((s) => (
        <div key={s.n} style={{ display: "flex", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 28, height: 28, minWidth: 28, background: "rgba(59,130,246,0.15)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#60a5fa", marginTop: 2 }}>{s.n}</div>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "#e8e6e3" }}>{s.title}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#8b949e", lineHeight: 1.6 }}>{s.desc}</p>
          </div>
        </div>
      ))}
      <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 8, padding: 12, marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "#4ade80", lineHeight: 1.6 }}>
          💡 <strong>Google Cloud Vision ofrece 1,000 requests/mes gratis.</strong> Para un PDF de 30 páginas con 15 escaneadas, usás solo 15 requests. Te alcanza para ~66 PDFs por mes sin pagar nada.
        </p>
      </div>
    </div>
  );
}

// ─── Main App ───
export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [progress, setProgress] = useState({ current: 0, total: 0, pagesWithText: 0, pagesNeedOCR: 0 });
  const [errorMsg, setErrorMsg] = useState("");
  const [outputUrl, setOutputUrl] = useState(null);
  const [outputFilename, setOutputFilename] = useState("");
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);

  const addLog = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString("es-AR");
    setLogs((prev) => [...prev.slice(-200), `[${ts}] ${msg}`]);
  }, []);

  useEffect(() => { return () => { if (outputUrl) URL.revokeObjectURL(outputUrl); }; }, [outputUrl]);

  const reset = () => {
    cancelRef.current = false;
    setStatus(STATUS.IDLE);
    setProgress({ current: 0, total: 0, pagesWithText: 0, pagesNeedOCR: 0 });
    setErrorMsg("");
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null); setOutputFilename(""); setLogs([]);
  };

  const handleFileChange = (e) => {
    reset();
    const f = e.target.files?.[0];
    if (f && f.type === "application/pdf") setFile(f);
    else if (f) { setErrorMsg("Solo se aceptan archivos PDF."); setStatus(STATUS.ERROR); }
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); reset();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === "application/pdf") setFile(f);
    else if (f) { setErrorMsg("Solo se aceptan archivos PDF."); setStatus(STATUS.ERROR); }
  };

  const handleCancel = () => { cancelRef.current = true; setStatus(STATUS.CANCELLED); addLog("⛔ Cancelado"); };

  const processFile = async () => {
    if (!file || !apiKey.trim()) return;
    cancelRef.current = false;
    setErrorMsg(""); setOutputUrl(null); setLogs([]);

    try {
      setStatus(STATUS.LOADING_LIBS);
      addLog("Cargando pdf.js...");
      await loadScript(`${PDFJS_CDN}/pdf.min.js`);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      addLog("Cargando jsPDF...");
      await loadScript(JSPDF_CDN);
      addLog("✓ Librerías listas");
      if (cancelRef.current) return;

      setStatus(STATUS.READING_PDF);
      addLog("Leyendo PDF...");
      const arrayBuf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
      const totalPages = pdf.numPages;
      addLog(`PDF: ${totalPages} páginas`);
      if (cancelRef.current) return;

      setStatus(STATUS.ANALYZING);
      const pageAnalysis = [];
      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const textLength = tc.items.reduce((acc, item) => acc + item.str.trim().length, 0);
        const hasText = textLength > 20;
        pageAnalysis.push({ pageNum: i, hasText, needsOCR: !hasText, textLength });
        if (cancelRef.current) return;
      }
      const pagesWithText = pageAnalysis.filter((p) => p.hasText).length;
      const pagesNeedOCR = pageAnalysis.filter((p) => p.needsOCR).length;
      setProgress({ current: 0, total: pagesNeedOCR, pagesWithText, pagesNeedOCR });
      addLog(`${pagesWithText} con texto, ${pagesNeedOCR} necesitan OCR`);
      if (pagesNeedOCR === 0) addLog("ℹ Todas las páginas ya tienen texto — se generará el PDF igualmente");
      if (cancelRef.current) return;

      setStatus(STATUS.OCR_PROCESSING);
      const SCALE = 2;
      const pageDataList = [];

      for (let i = 0; i < totalPages; i++) {
        if (cancelRef.current) return;
        const pageNum = i + 1;
        const page = await pdf.getPage(pageNum);
        const vp = page.getViewport({ scale: SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        const imgDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const pd = { imgDataUrl, width: vp.width, height: vp.height, origWidth: vp.width / SCALE, origHeight: vp.height / SCALE, ocrWords: [] };

        if (pageAnalysis[i].needsOCR) {
          addLog(`OCR pág ${pageNum}/${totalPages} → Google Vision...`);
          try {
            const base64 = canvasToBase64(canvas);
            const result = await callVisionOCR(base64, apiKey.trim());
            pd.ocrWords = result.words;
            setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
            addLog(`✓ Pág ${pageNum}: ${result.words.length} palabras`);
          } catch (apiErr) {
            addLog(`⚠ Pág ${pageNum}: ${apiErr.message}`);
            if (apiErr.message.includes("403") || apiErr.message.includes("401")) {
              throw new Error("API key inválida o Cloud Vision API no está habilitada en tu proyecto. Revisá la guía de configuración.");
            }
          }
        } else {
          addLog(`→ Pág ${pageNum}: tiene texto, skip`);
        }
        pageDataList.push(pd);
        canvas.remove();
        if (pageAnalysis[i].needsOCR && i < totalPages - 1) await new Promise((r) => setTimeout(r, 200));
      }
      if (cancelRef.current) return;

      setStatus(STATUS.GENERATING_PDF);
      addLog("Generando PDF searchable...");
      const { jsPDF } = window.jspdf;
      const fp = pageDataList[0];
      const doc = new jsPDF({
        orientation: fp.origWidth > fp.origHeight ? "landscape" : "portrait",
        unit: "px", format: [fp.origWidth, fp.origHeight], compress: true,
      });

      for (let i = 0; i < pageDataList.length; i++) {
        if (cancelRef.current) return;
        const pd = pageDataList[i];
        if (i > 0) doc.addPage([pd.origWidth, pd.origHeight], pd.origWidth > pd.origHeight ? "landscape" : "portrait");
        doc.addImage(pd.imgDataUrl, "JPEG", 0, 0, pd.origWidth, pd.origHeight);
        if (pd.ocrWords.length > 0) {
          const sx = pd.origWidth / pd.width, sy = pd.origHeight / pd.height;
          doc.setTextColor(0, 0, 0);
          for (const w of pd.ocrWords) {
            if (!w.text.trim() || !w.vertices || w.vertices.length < 4) continue;
            const x = (w.vertices[0]?.x || 0) * sx;
            const y = (w.vertices[0]?.y || 0) * sy;
            const y2 = (w.vertices[3]?.y || 0) * sy;
            const wordHeight = Math.abs(y2 - y);
            if (wordHeight < 1) continue;
            doc.setFontSize(Math.max(wordHeight * 0.85, 4));
            doc.internal.write("3 Tr");
            doc.text(w.text, x, y + wordHeight * 0.78);
          }
          doc.internal.write("0 Tr");
        }
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setOutputFilename(`${file.name.replace(/\.pdf$/i, "")}_OCR.pdf`);
      setStatus(STATUS.DONE);
      addLog(`✓ Listo: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      if (!cancelRef.current) {
        setErrorMsg(err.message || "Error desconocido");
        setStatus(STATUS.ERROR);
        addLog(`❌ ${err.message}`);
      }
    }
  };

  const isProcessing = [STATUS.LOADING_LIBS, STATUS.READING_PDF, STATUS.ANALYZING, STATUS.OCR_PROCESSING, STATUS.GENERATING_PDF].includes(status);
  const ocrPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const canStart = file && apiKey.trim().length > 10 && !isProcessing && status !== STATUS.DONE;

  // Styles
  const S = {
    page: { minHeight: "100vh", background: "#08090c", color: "#e8e6e3", fontFamily: "'JetBrains Mono', 'SF Mono', monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px 60px" },
    card: { width: "100%", maxWidth: 640, background: "#0f1116", border: "1px solid #1a1d27", borderRadius: 16, padding: "28px 28px 32px", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" },
    btnPrimary: { width: "100%", padding: "14px 24px", background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", boxShadow: "0 4px 20px rgba(59,130,246,0.3)", opacity: canStart ? 1 : 0.4 },
    btnGhost: { padding: "10px 20px", background: "transparent", color: "#9ca3af", border: "1px solid #1a1d27", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" },
    input: { width: "100%", padding: "12px 14px", background: "#13161d", border: "1px solid #1a1d27", borderRadius: 8, color: "#e8e6e3", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box" },
    label: { fontSize: 12, color: "#8b949e", marginBottom: 6, display: "block", fontWeight: 500 },
    sectionGap: { marginBottom: 20 },
  };

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <div style={{ width: 46, height: 46, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, color: "#fff", boxShadow: "0 0 28px rgba(59,130,246,0.25)" }}>🔍</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, fontFamily: "'Space Grotesk', sans-serif", background: "linear-gradient(90deg, #3b82f6, #93c5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            OCR PDF Converter
          </h1>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.6 }}>
          Convierte PDFs escaneados en documentos searchable<br />
          con Google Cloud Vision · Gratuito · Open Source
        </p>
      </div>

      {/* Main Card */}
      <div style={S.card}>

        {/* API Key section */}
        <div style={S.sectionGap}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={S.label}>🔑 Tu API Key de Google Cloud</label>
            <button onClick={() => setShowGuide(!showGuide)} style={{ background: "transparent", border: "none", color: "#3b82f6", fontSize: 12, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", textDecoration: "underline" }}>
              {showGuide ? "Cerrar guía" : "¿Cómo la consigo?"}
            </button>
          </div>
          {showGuide && <ApiGuide onClose={() => setShowGuide(false)} />}
          <div style={{ position: "relative" }}>
            <input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              style={{ ...S.input, paddingRight: 44 }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 16 }}
              title={showApiKey ? "Ocultar" : "Mostrar"}
            >{showApiKey ? "🙈" : "👁"}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
            <span style={{ fontSize: 11, color: "#4ade80" }}>Tu key se usa solo en tu navegador. No se envía ni almacena en ningún servidor.</span>
          </div>
        </div>

        {/* File drop zone */}
        {!isProcessing && status !== STATUS.DONE && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            style={{
              border: `2px dashed ${file ? "#3b82f6" : "#1a1d27"}`,
              borderRadius: 12, padding: "36px 20px", textAlign: "center",
              cursor: "pointer", background: file ? "rgba(59,130,246,0.03)" : "transparent",
              marginBottom: 20, transition: "all 0.2s",
            }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileChange} style={{ display: "none" }} />
            {file ? (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#3b82f6" }}>{file.name}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{(file.size / 1024 / 1024).toFixed(2)} MB · Click para cambiar</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>📂</div>
                <div style={{ fontSize: 14, color: "#9ca3af" }}>Arrastrá un PDF o hacé click para seleccionar</div>
              </div>
            )}
          </div>
        )}

        {/* Start button */}
        {!isProcessing && status !== STATUS.DONE && (
          <button onClick={processFile} disabled={!canStart} style={S.btnPrimary}>
            {!apiKey.trim() ? "Ingresá tu API Key primero" : !file ? "Seleccioná un PDF" : "Convertir a PDF Searchable"}
          </button>
        )}

        {/* Progress */}
        {isProcessing && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#60a5fa" }}>{statusMessages[status]}</span>
              {status === STATUS.OCR_PROCESSING && progress.total > 0 && (
                <span style={{ fontSize: 13, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>{progress.current}/{progress.total} · {ocrPct}%</span>
              )}
            </div>
            <div style={{ width: "100%", height: 6, background: "#1a1d27", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
              <div style={{
                height: "100%", borderRadius: 3, transition: "width 0.4s ease",
                background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                width: status === STATUS.OCR_PROCESSING ? `${Math.max(ocrPct, 5)}%` : status === STATUS.GENERATING_PDF ? "92%" : "20%",
                boxShadow: "0 0 10px rgba(59,130,246,0.3)",
              }} />
            </div>
            {(status === STATUS.OCR_PROCESSING || status === STATUS.GENERATING_PDF) && progress.total > 0 && (
              <div style={{ display: "flex", gap: 20, fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
                <span>📝 {progress.pagesWithText} con texto</span>
                <span>🔍 {progress.pagesNeedOCR} requieren OCR</span>
              </div>
            )}
            <button onClick={handleCancel} style={{ ...S.btnGhost, width: "100%", color: "#ef4444", borderColor: "rgba(239,68,68,0.2)" }}>Cancelar</button>
          </div>
        )}

        {/* Done */}
        {status === STATUS.DONE && outputUrl && (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 64, height: 64, background: "rgba(34,197,94,0.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 32, border: "2px solid rgba(34,197,94,0.15)" }}>✅</div>
            <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: "#22c55e", marginBottom: 6 }}>PDF Searchable listo</p>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{outputFilename}</p>
            {progress.pagesNeedOCR > 0 && (
              <p style={{ fontSize: 11, color: "#4b5563", marginBottom: 24 }}>
                {progress.pagesNeedOCR} páginas procesadas con OCR · {progress.pagesWithText} preservadas
              </p>
            )}
            <a href={outputUrl} download={outputFilename} style={{
              display: "inline-block", padding: "14px 36px",
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              color: "#000", borderRadius: 10, fontSize: 15, fontWeight: 700,
              textDecoration: "none", fontFamily: "'Space Grotesk', sans-serif",
              boxShadow: "0 4px 16px rgba(34,197,94,0.3)", marginBottom: 16,
            }}>⬇ Descargar PDF</a>
            <br />
            <button onClick={() => { reset(); setFile(null); }} style={{ ...S.btnGhost, marginTop: 8 }}>Procesar otro archivo</button>
          </div>
        )}

        {/* Error */}
        {status === STATUS.ERROR && (
          <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: 10, padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 14, color: "#ef4444", margin: 0, fontWeight: 600 }}>Error</p>
            <p style={{ fontSize: 12, color: "#f87171", margin: "8px 0 0", lineHeight: 1.6 }}>{errorMsg}</p>
            <button onClick={reset} style={{ ...S.btnGhost, marginTop: 12, fontSize: 12, padding: "8px 16px" }}>Reintentar</button>
          </div>
        )}

        {/* Cancelled */}
        {status === STATUS.CANCELLED && (
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <p style={{ fontSize: 14, color: "#f59e0b", marginBottom: 16 }}>Cancelado</p>
            <button onClick={reset} style={S.btnGhost}>Reintentar</button>
          </div>
        )}
      </div>

      {/* Logs */}
      <div style={{ width: "100%", maxWidth: 640, marginTop: 16 }}>
        <button onClick={() => setShowLogs(!showLogs)} style={{ background: "transparent", border: "none", color: "#4b5563", fontSize: 12, cursor: "pointer", padding: "8px 0", fontFamily: "'JetBrains Mono', monospace" }}>
          {showLogs ? "▼" : "▶"} Logs ({logs.length})
        </button>
        {showLogs && (
          <div style={{ background: "#0a0c10", border: "1px solid #1a1d27", borderRadius: 8, padding: 16, maxHeight: 260, overflowY: "auto", fontSize: 11, lineHeight: 1.8, color: "#6b7280" }}>
            {logs.length === 0 ? <span style={{ color: "#2a2d37" }}>Sin actividad</span>
              : logs.map((l, i) => <div key={i} style={{ color: l.includes("✓") ? "#22c55e" : l.includes("❌") ? "#ef4444" : l.includes("⛔") || l.includes("⚠") ? "#f59e0b" : "#6b7280" }}>{l}</div>)}
          </div>
        )}
      </div>

      {/* How it works */}
      <div style={{ width: "100%", maxWidth: 640, marginTop: 28 }}>
        <div style={{ background: "#0f1116", border: "1px solid #1a1d27", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", color: "#93c5fd", margin: "0 0 14px" }}>⚡ ¿Cómo funciona?</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {[
              { icon: "📄", text: "Subís tu PDF" },
              { icon: "🔎", text: "Detecta páginas escaneadas" },
              { icon: "🤖", text: "OCR con Google Vision" },
              { icon: "📥", text: "PDF searchable para descargar" },
            ].map((s, i) => (
              <div key={i} style={{ background: "rgba(59,130,246,0.04)", borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.5 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Privacy + Branding footer */}
      <div style={{ width: "100%", maxWidth: 640, marginTop: 28, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#2a2d37", lineHeight: 1.8, marginBottom: 20 }}>
          🔒 Tu API key y tus archivos nunca se almacenan. Las imágenes se envían directamente<br />
          desde tu navegador a Google Cloud Vision. El PDF final se genera localmente.
        </div>
        <div style={{ borderTop: "1px solid #1a1d27", paddingTop: 20 }}>
          <p style={{ fontSize: 12, color: "#4b5563", margin: "0 0 4px" }}>
            Hecho por <a href="https://www.linkedin.com/in/lucas-aguilar-legaltech/" target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>Lucas Aguilar</a> · Abogado Tech
          </p>
          <p style={{ fontSize: 11, color: "#2a2d37", margin: 0 }}>
            Herramienta gratuita para la comunidad legal · Montecarlo, Misiones 🇦🇷
          </p>
        </div>
      </div>
    </div>
  );
}
