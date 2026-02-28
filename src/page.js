"use client";
import { useState, useRef, useCallback, useEffect } from "react";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const PDFLIB_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
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
    const msg = errData?.error?.message || res.statusText;
    if (res.status === 403 && msg.includes("has not been used")) {
      throw new Error("VISION_NOT_ENABLED");
    }
    if (res.status === 400 && msg.includes("API key not valid")) {
      throw new Error("INVALID_KEY");
    }
    if (res.status === 403 && msg.includes("restricted")) {
      throw new Error("KEY_RESTRICTED");
    }
    throw new Error(`Vision API error ${res.status}: ${msg}`);
  }
  const data = await res.json();
  const annotations = data.responses?.[0]?.textAnnotations;
  if (!annotations || annotations.length === 0) return { fullText: "", words: [] };
  return {
    fullText: annotations[0].description,
    words: annotations.slice(1).map((a) => ({
      text: a.description,
      vertices: a.boundingPoly?.vertices || [],
    })),
  };
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

const MAX_PAGES_WARNING = 50;

// ─── API Guide Component ───
function ApiGuide({ onClose }) {
  const steps = [
    {
      n: "1",
      title: "Ir a Google Cloud Console",
      warn: false,
      desc: (
        <span>
          Ingresá a{" "}
          <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>
            console.cloud.google.com
          </a>{" "}
          e iniciá sesión. Si es tu primera vez, aceptá los términos de servicio y creá un <strong style={{ color: "#e8e6e3" }}>Proyecto Nuevo</strong> (ej: "OCR Legal").
        </span>
      ),
    },
    {
      n: "2",
      title: "Habilitar Cloud Vision API",
      warn: false,
      desc: (
        <span>
          En el buscador superior de la consola, escribí <strong style={{ color: "#e8e6e3" }}>Cloud Vision API</strong>, seleccionala en los resultados y hacé click en el botón azul <strong style={{ color: "#e8e6e3" }}>Habilitar</strong>. Este paso es obligatorio.
        </span>
      ),
    },
    {
      n: "3",
      title: "Crear y Restringir la API Key (Crítico)",
      warn: true,
      desc: (
        <span>
          Andá al menú lateral izquierdo:{" "}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>
            APIs y servicios → Credenciales
          </a>
          . Hacé click en <strong style={{ color: "#e8e6e3" }}>Crear credenciales</strong> → <strong style={{ color: "#e8e6e3" }}>Clave de API</strong>.
          <br /><br />
          <span style={{ color: "#f59e0b" }}>⚠️ Regla de seguridad:</span> Hacé click en la clave recién creada, bajá hasta "Restricciones de API", seleccioná <strong style={{ color: "#e8e6e3" }}>Restringir clave</strong> y marcá únicamente <strong style={{ color: "#e8e6e3" }}>Cloud Vision API</strong>. Esto evita que te roben la cuota o te generen gastos si tu clave queda expuesta.
        </span>
      ),
    },
    {
      n: "4",
      title: "Pegar la key acá",
      warn: false,
      desc: "Copiá la API key (empieza con AIza...) y pegala en el campo de arriba. Listo — ya podés convertir PDFs.",
    },
  ];

  return (
    <div style={{ background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-display)", color: "#60a5fa" }}>
          📋 Cómo obtener tu API Key gratis
        </h3>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
      </div>
      {steps.map((s) => (
        <div key={s.n} style={{ display: "flex", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 28, height: 28, minWidth: 28, background: s.warn ? "rgba(245,158,11,0.2)" : "rgba(59,130,246,0.15)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: s.warn ? "#f59e0b" : "#60a5fa", marginTop: 2 }}>{s.n}</div>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: s.warn ? "#f59e0b" : "#e8e6e3" }}>{s.title}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#8b949e", lineHeight: 1.7 }}>{s.desc}</p>
          </div>
        </div>
      ))}
      <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.12)", borderRadius: 8, padding: 12, marginTop: 4 }}>
        <p style={{ margin: 0, fontSize: 12, color: "#4ade80", lineHeight: 1.7 }}>
          💡 <strong>Gratis:</strong> Google Cloud Vision ofrece 1,000 llamadas/mes sin costo. Un PDF de 30 páginas con 15 escaneadas usa solo 15 llamadas → alcanza para ~66 documentos por mes.
        </p>
      </div>
    </div>
  );
}

// ─── Security Warning Component ───
function SecurityNotice() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, padding: "14px 16px", marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
          🔐 Nota importante sobre tu API Key
        </p>
        <button onClick={() => setExpanded(!expanded)} style={{ background: "transparent", border: "none", color: "#f59e0b", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-display)", textDecoration: "underline" }}>
          {expanded ? "Cerrar" : "Leer más"}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#d4a056", lineHeight: 1.8 }}>
          <p style={{ margin: "0 0 8px" }}>
            Esta herramienta hace las llamadas a Google Cloud Vision <strong>directamente desde tu navegador</strong>. Esto significa que tu API key viaja en cada request y es visible en las herramientas de desarrollador del navegador (pestaña Network).
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <strong>Para protegerte:</strong>
          </p>
          <p style={{ margin: "0 0 4px", paddingLeft: 12 }}>
            → <strong>Restringí tu key</strong> en Google Cloud Console para que solo funcione con Cloud Vision API.
          </p>
          <p style={{ margin: "0 0 4px", paddingLeft: 12 }}>
            → <strong>Agregá restricción por HTTP referrer</strong> al dominio de esta herramienta para que no funcione desde otros sitios.
          </p>
          <p style={{ margin: "0 0 4px", paddingLeft: 12 }}>
            → <strong>No compartas pantalla</strong> mientras usás la herramienta sin ocultar las herramientas de desarrollador.
          </p>
          <p style={{ margin: "0 0 4px", paddingLeft: 12 }}>
            → <strong>Monitoreá tu consumo</strong> en Google Cloud Console → Facturación para detectar uso no autorizado.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#a07830" }}>
            Sin estas restricciones, si alguien obtiene tu key, podría generar cargos en tu cuenta de Google Cloud.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Limitations Component ───
function Limitations() {
  return (
    <div style={{ background: "#0f1116", border: "1px solid #1a1d27", borderRadius: 12, padding: 20, marginTop: 20 }}>
      <h3 style={{ fontSize: 14, fontFamily: "var(--font-display)", color: "#f59e0b", margin: "0 0 14px" }}>⚠️ Limitaciones</h3>
      <div style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.8 }}>
        <p style={{ margin: "0 0 8px" }}>
          <strong style={{ color: "#e8e6e3" }}>Procesamiento:</strong> Recomendamos PDFs de hasta 50 páginas. Documentos más largos pueden tardar varios minutos y consumir más llamadas API.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          <strong style={{ color: "#e8e6e3" }}>Cuota gratuita:</strong> 1,000 llamadas/mes a Google Cloud Vision. Cada página escaneada = 1 llamada. Las páginas que ya tienen texto NO consumen cuota.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          <strong style={{ color: "#e8e6e3" }}>Precisión:</strong> El OCR depende de la calidad del escaneo. Documentos muy borrosos, con manchas o escritos a mano pueden tener errores. El texto superpuesto es funcional para búsqueda, no tiene posicionamiento pixel-perfect.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#e8e6e3" }}>Conexión:</strong> Requiere internet para las llamadas a Google Cloud Vision. El PDF final se genera localmente en tu navegador.
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
  const [errorType, setErrorType] = useState(null);
  const [outputUrl, setOutputUrl] = useState(null);
  const [outputFilename, setOutputFilename] = useState("");
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);
  const timerRef = useRef(null);

  const addLog = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString("es-AR");
    setLogs((prev) => [...prev.slice(-200), `[${ts}] ${msg}`]);
  }, []);

  useEffect(() => { return () => { if (outputUrl) URL.revokeObjectURL(outputUrl); clearInterval(timerRef.current); }; }, [outputUrl]);

  const startTimer = () => {
    setElapsedTime(0);
    timerRef.current = setInterval(() => setElapsedTime((t) => t + 1), 1000);
  };
  const stopTimer = () => clearInterval(timerRef.current);
  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const reset = () => {
    cancelRef.current = false;
    setStatus(STATUS.IDLE);
    setProgress({ current: 0, total: 0, pagesWithText: 0, pagesNeedOCR: 0 });
    setErrorMsg(""); setErrorType(null);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null); setOutputFilename(""); setLogs([]);
    stopTimer(); setElapsedTime(0);
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

  const handleCancel = () => { cancelRef.current = true; setStatus(STATUS.CANCELLED); addLog("⛔ Cancelado"); stopTimer(); };

  const processFile = async () => {
    if (!file || !apiKey.trim()) return;
    cancelRef.current = false;
    setErrorMsg(""); setErrorType(null); setOutputUrl(null); setLogs([]);
    startTimer();

    try {
      setStatus(STATUS.LOADING_LIBS);
      addLog("Cargando pdf.js...");
      await loadScript(`${PDFJS_CDN}/pdf.min.js`);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      addLog("Cargando pdf-lib...");
      await loadScript(PDFLIB_CDN);
      addLog("✓ Librerías listas");
      if (cancelRef.current) return;

      setStatus(STATUS.READING_PDF);
      addLog("Leyendo PDF...");
      const arrayBuf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
      const totalPages = pdf.numPages;
      addLog(`PDF: ${totalPages} páginas`);
      if (totalPages > MAX_PAGES_WARNING) {
        addLog(`⚠ PDF con ${totalPages} páginas — el proceso puede tardar varios minutos`);
      }
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
      if (pagesNeedOCR === 0) addLog("ℹ Todas las páginas ya tienen texto");
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
          addLog(`OCR pág ${pageNum}/${totalPages}...`);
          try {
            const base64 = canvasToBase64(canvas);
            const result = await callVisionOCR(base64, apiKey.trim());
            pd.ocrWords = result.words;
            setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
            addLog(`✓ Pág ${pageNum}: ${result.words.length} palabras`);
          } catch (apiErr) {
            if (apiErr.message === "VISION_NOT_ENABLED") {
              throw new Error("Cloud Vision API no está habilitada en tu proyecto. Abrí la guía (¿Cómo la consigo?) y seguí el paso 2.");
            }
            if (apiErr.message === "INVALID_KEY") {
              throw new Error("La API key no es válida. Verificá que la hayas copiado completa desde Google Cloud Console.");
            }
            if (apiErr.message === "KEY_RESTRICTED") {
              throw new Error("Tu API key tiene restricciones que impiden usar Cloud Vision API, o la restricción por HTTP referrer no incluye este dominio. Revisá las restricciones en Cloud Console → Credenciales.");
            }
            addLog(`⚠ Pág ${pageNum}: ${apiErr.message}`);
          }
        } else {
          addLog(`→ Pág ${pageNum}: tiene texto, skip`);
        }
        pageDataList.push(pd);
        canvas.remove();
        if (pageAnalysis[i].needsOCR && i < totalPages - 1) await new Promise((r) => setTimeout(r, 150));
      }
      if (cancelRef.current) return;

      setStatus(STATUS.GENERATING_PDF);
      addLog("Generando PDF searchable con pdf-lib...");
      const { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFDict, PDFStream,
              PDFHexString, PDFNumber, PDFRawStream } = window.PDFLib;

      const pdfDoc = await PDFDocument.create();
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (let i = 0; i < pageDataList.length; i++) {
        if (cancelRef.current) return;
        const pd = pageDataList[i];

        // Embed the page image — decode base64 directly (fetch of data: URLs fails in some browsers)
        const base64Data = pd.imgDataUrl.split(",")[1];
        const binaryStr = atob(base64Data);
        const imgBytes = new Uint8Array(binaryStr.length);
        for (let b = 0; b < binaryStr.length; b++) imgBytes[b] = binaryStr.charCodeAt(b);
        const img = await pdfDoc.embedJpg(imgBytes);

        // Create page
        const page = pdfDoc.addPage([pd.origWidth, pd.origHeight]);

        // Draw image
        page.drawImage(img, { x: 0, y: 0, width: pd.origWidth, height: pd.origHeight });

        // Add OCR text using raw content stream approach
        // This matches the exact structure PyMuPDF generates for searchable PDFs:
        // BT /FontName Size Tf 3 Tr 1 0 0 1 X Y Tm (text)Tj ET
        if (pd.ocrWords.length > 0) {
          const sx = pd.origWidth / pd.width;
          const sy = pd.origHeight / pd.height;

          // Get the font key that pdf-lib assigned to helvetica on this page
          // We need to ensure the font is in the page's Resources
          // First, draw a dummy text to force pdf-lib to register the font
          page.drawText(" ", { x: -100, y: -100, size: 1, font: helvetica, opacity: 0 });

          // Now find the font key from the page resources
          const resources = page.node.get(PDFName.of("Resources"));
          const fontDict = resources?.get?.(PDFName.of("Font"));
          let fontKey = "F1"; // default
          if (fontDict) {
            const entries = fontDict instanceof PDFDict ? fontDict.entries() : [];
            for (const [key, val] of entries) {
              // Find the key that references our helvetica font
              fontKey = key.toString().replace("/", "");
              break; // First font should be helvetica
            }
          }

          // Build raw content stream with invisible text operators
          let streamContent = "";
          let wordsAdded = 0;

          for (const w of pd.ocrWords) {
            if (!w.text.trim() || !w.vertices || w.vertices.length < 4) continue;

            const x = (w.vertices[0]?.x || 0) * sx;
            const yTop = (w.vertices[0]?.y || 0) * sy;
            const yBot = (w.vertices[3]?.y || 0) * sy;
            const wordHeight = Math.abs(yBot - yTop);
            if (wordHeight < 1) continue;

            // PDF y-axis: 0 is bottom
            const pdfY = pd.origHeight - yBot;
            const fontSize = Math.max(wordHeight * 0.85, 4);

            // Convert text to hex for PDF
            let hex = "";
            let valid = true;
            for (let c = 0; c < w.text.length; c++) {
              const code = w.text.charCodeAt(c);
              if (code > 255) { valid = false; break; } // Skip non-latin1
              hex += code.toString(16).padStart(2, "0");
            }
            if (!valid || !hex) continue;

            // Exact format that PyMuPDF uses for invisible OCR text:
            // BT 1 0 0 1 X Y Tm /Font Size Tf 3 Tr <hex>Tj ET
            streamContent += `BT\n`;
            streamContent += `1 0 0 1 ${x.toFixed(2)} ${pdfY.toFixed(2)} Tm\n`;
            streamContent += `/${fontKey} ${fontSize.toFixed(1)} Tf\n`;
            streamContent += `3 Tr\n`;
            streamContent += `<${hex}> Tj\n`;
            streamContent += `ET\n`;
            wordsAdded++;
          }

          if (streamContent && wordsAdded > 0) {
            // Create a new content stream and append it to the page
            const streamBytes = new TextEncoder().encode(streamContent);
            const stream = pdfDoc.context.stream(streamBytes);
            const streamRef = pdfDoc.context.register(stream);

            // Append this stream to the page's existing Contents array
            const existingContents = page.node.get(PDFName.of("Contents"));
            if (existingContents) {
              // If Contents is a single ref, wrap in array
              const contentsArray = existingContents instanceof PDFArray
                ? existingContents
                : pdfDoc.context.obj([existingContents]);
              contentsArray.push(streamRef);
              page.node.set(PDFName.of("Contents"), contentsArray);
            }

            addLog(`  Pág ${i+1}: ${wordsAdded} palabras en capa OCR`);
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setOutputFilename(`${file.name.replace(/\.pdf$/i, "")}_OCR.pdf`);
      setStatus(STATUS.DONE);
      stopTimer();
      addLog(`✓ Listo: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      if (!cancelRef.current) {
        setErrorMsg(err.message || "Error desconocido");
        setErrorType(
          err.message.includes("Vision") || err.message.includes("API key") || err.message.includes("restricciones")
            ? "api_config" : "generic"
        );
        setStatus(STATUS.ERROR);
        addLog(`❌ ${err.message}`);
        stopTimer();
      }
    }
  };

  const isProcessing = [STATUS.LOADING_LIBS, STATUS.READING_PDF, STATUS.ANALYZING, STATUS.OCR_PROCESSING, STATUS.GENERATING_PDF].includes(status);
  const ocrPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const canStart = file && apiKey.trim().length > 10 && !isProcessing && status !== STATUS.DONE;

  const css = `
    :root { --font-mono: 'JetBrains Mono', 'SF Mono', monospace; --font-display: 'Space Grotesk', sans-serif; }
    * { box-sizing: border-box; }
    a:hover { opacity: 0.85; }
    ::selection { background: rgba(59,130,246,0.3); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  `;

  return (
    <div style={{ minHeight: "100vh", background: "#08090c", color: "#e8e6e3", fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column", alignItems: "center", padding: "36px 20px 60px" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <div style={{ width: 46, height: 46, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#fff", boxShadow: "0 0 28px rgba(59,130,246,0.2)" }}>🔍</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, fontFamily: "var(--font-display)", background: "linear-gradient(90deg, #3b82f6, #93c5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            OCR PDF Converter
          </h1>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.7 }}>
          PDFs escaneados → documentos searchable<br />
          Google Cloud Vision · Gratuito · Open Source
        </p>
      </div>

      {/* Main Card */}
      <div style={{ width: "100%", maxWidth: 640, background: "#0f1116", border: "1px solid #1a1d27", borderRadius: 16, padding: "24px 24px 28px", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>

        {/* API Key */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: "#8b949e", fontWeight: 500 }}>🔑 Tu API Key de Google Cloud</label>
            <button onClick={() => setShowGuide(!showGuide)} style={{ background: "transparent", border: "none", color: "#3b82f6", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-display)", textDecoration: "underline" }}>
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
              style={{ width: "100%", padding: "12px 44px 12px 14px", background: "#13161d", border: "1px solid #1a1d27", borderRadius: 8, color: "#e8e6e3", fontSize: 13, fontFamily: "var(--font-mono)", outline: "none", boxSizing: "border-box" }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 16 }}
            >{showApiKey ? "🙈" : "👁"}</button>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0, marginTop: 4 }} />
            <span style={{ fontSize: 11, color: "#d4a056", lineHeight: 1.5 }}>
              Tu key se usa en tu navegador para llamar a Google Cloud Vision. No se almacena en ningún servidor, pero es visible en las herramientas de desarrollador del navegador. <strong>Restringila</strong> en Cloud Console (paso 3 de la guía).
            </span>
          </div>
        </div>

        {/* Drop zone */}
        {!isProcessing && status !== STATUS.DONE && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            style={{
              border: `2px dashed ${file ? "#3b82f6" : "#1a1d27"}`,
              borderRadius: 12, padding: "32px 20px", textAlign: "center",
              cursor: "pointer", background: file ? "rgba(59,130,246,0.03)" : "transparent",
              marginBottom: 20, transition: "border-color 0.2s",
            }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileChange} style={{ display: "none" }} />
            {file ? (
              <div>
                <div style={{ fontSize: 30, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#3b82f6" }}>{file.name}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{(file.size / 1024 / 1024).toFixed(2)} MB · Click para cambiar</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 30, marginBottom: 8, opacity: 0.4 }}>📂</div>
                <div style={{ fontSize: 13, color: "#9ca3af" }}>Arrastrá un PDF o hacé click para seleccionar</div>
                <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6 }}>Recomendado: hasta 50 páginas</div>
              </div>
            )}
          </div>
        )}

        {/* Start button */}
        {!isProcessing && status !== STATUS.DONE && (
          <button
            onClick={processFile}
            disabled={!canStart}
            style={{
              width: "100%", padding: "14px 24px",
              background: canStart ? "linear-gradient(135deg, #3b82f6, #2563eb)" : "#1a1d27",
              color: canStart ? "#fff" : "#4b5563",
              border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700,
              cursor: canStart ? "pointer" : "default",
              fontFamily: "var(--font-display)",
              boxShadow: canStart ? "0 4px 20px rgba(59,130,246,0.3)" : "none",
              transition: "all 0.2s",
            }}
          >
            {!apiKey.trim() ? "Ingresá tu API Key primero" : !file ? "Seleccioná un PDF" : "Convertir a PDF Searchable"}
          </button>
        )}

        {/* Progress */}
        {isProcessing && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#60a5fa", animation: "pulse 2s infinite" }}>{statusMessages[status]}</span>
              <span style={{ fontSize: 12, color: "#4b5563", fontVariantNumeric: "tabular-nums" }}>{formatTime(elapsedTime)}</span>
            </div>
            {status === STATUS.OCR_PROCESSING && progress.total > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Página {progress.current}/{progress.total}</span>
                <span style={{ fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>{ocrPct}%</span>
              </div>
            )}
            <div style={{ width: "100%", height: 6, background: "#1a1d27", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
              <div style={{
                height: "100%", borderRadius: 3, transition: "width 0.4s ease",
                background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                width: status === STATUS.OCR_PROCESSING ? `${Math.max(ocrPct, 3)}%` : status === STATUS.GENERATING_PDF ? "92%" : "15%",
                boxShadow: "0 0 10px rgba(59,130,246,0.3)",
              }} />
            </div>
            {(status === STATUS.OCR_PROCESSING || status === STATUS.GENERATING_PDF) && progress.total > 0 && (
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#6b7280", marginBottom: 16 }}>
                <span>📝 {progress.pagesWithText} con texto</span>
                <span>🔍 {progress.pagesNeedOCR} requieren OCR</span>
              </div>
            )}
            <button onClick={handleCancel} style={{ width: "100%", padding: "10px 20px", background: "transparent", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-display)" }}>Cancelar</button>
          </div>
        )}

        {/* Done */}
        {status === STATUS.DONE && outputUrl && (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 60, height: 60, background: "rgba(34,197,94,0.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 28, border: "2px solid rgba(34,197,94,0.15)" }}>✅</div>
            <p style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-display)", color: "#22c55e", marginBottom: 4 }}>PDF Searchable listo</p>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>{outputFilename}</p>
            <p style={{ fontSize: 11, color: "#4b5563", marginBottom: 20 }}>
              {progress.pagesNeedOCR > 0 ? `${progress.pagesNeedOCR} págs OCR · ${progress.pagesWithText} preservadas · ` : ""}
              {formatTime(elapsedTime)}
            </p>
            <a href={outputUrl} download={outputFilename} style={{
              display: "inline-block", padding: "14px 36px",
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              color: "#000", borderRadius: 10, fontSize: 15, fontWeight: 700,
              textDecoration: "none", fontFamily: "var(--font-display)",
              boxShadow: "0 4px 16px rgba(34,197,94,0.3)", marginBottom: 14,
            }}>⬇ Descargar PDF</a>
            <br />
            <button onClick={() => { reset(); setFile(null); }} style={{ marginTop: 4, padding: "10px 20px", background: "transparent", color: "#9ca3af", border: "1px solid #1a1d27", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-display)" }}>Procesar otro archivo</button>
          </div>
        )}

        {/* Error */}
        {status === STATUS.ERROR && (
          <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: 10, padding: 18, marginTop: 16 }}>
            <p style={{ fontSize: 13, color: "#ef4444", margin: 0, fontWeight: 600 }}>Error</p>
            <p style={{ fontSize: 12, color: "#f87171", margin: "8px 0 0", lineHeight: 1.7 }}>{errorMsg}</p>
            {errorType === "api_config" && (
              <button onClick={() => { reset(); setShowGuide(true); }} style={{ marginTop: 12, padding: "8px 16px", background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-display)" }}>Ver guía de configuración</button>
            )}
            {errorType !== "api_config" && (
              <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", background: "transparent", color: "#9ca3af", border: "1px solid #1a1d27", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-display)" }}>Reintentar</button>
            )}
          </div>
        )}

        {/* Cancelled */}
        {status === STATUS.CANCELLED && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <p style={{ fontSize: 14, color: "#f59e0b", marginBottom: 14 }}>Cancelado ({formatTime(elapsedTime)})</p>
            <button onClick={reset} style={{ padding: "10px 20px", background: "transparent", color: "#9ca3af", border: "1px solid #1a1d27", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-display)" }}>Reintentar</button>
          </div>
        )}
      </div>

      {/* Logs */}
      <div style={{ width: "100%", maxWidth: 640, marginTop: 14 }}>
        <button onClick={() => setShowLogs(!showLogs)} style={{ background: "transparent", border: "none", color: "#4b5563", fontSize: 11, cursor: "pointer", padding: "6px 0", fontFamily: "var(--font-mono)" }}>
          {showLogs ? "▼" : "▶"} Logs ({logs.length})
        </button>
        {showLogs && (
          <div style={{ background: "#0a0c10", border: "1px solid #1a1d27", borderRadius: 8, padding: 14, maxHeight: 220, overflowY: "auto", fontSize: 11, lineHeight: 1.8, color: "#6b7280" }}>
            {logs.length === 0 ? <span style={{ color: "#2a2d37" }}>Sin actividad</span>
              : logs.map((l, i) => <div key={i} style={{ color: l.includes("✓") ? "#22c55e" : l.includes("❌") ? "#ef4444" : l.includes("⛔") || l.includes("⚠") ? "#f59e0b" : "#6b7280" }}>{l}</div>)}
          </div>
        )}
      </div>

      {/* How it works */}
      <div style={{ width: "100%", maxWidth: 640, marginTop: 20 }}>
        <div style={{ background: "#0f1116", border: "1px solid #1a1d27", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontFamily: "var(--font-display)", color: "#93c5fd", margin: "0 0 14px" }}>⚡ ¿Cómo funciona?</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            {[
              { icon: "📄", title: "Subís tu PDF", desc: "Arrastrá o seleccioná" },
              { icon: "🔎", title: "Análisis", desc: "Detecta págs escaneadas" },
              { icon: "🤖", title: "OCR", desc: "Google Cloud Vision" },
              { icon: "📥", title: "Descarga", desc: "PDF searchable listo" },
            ].map((s, i) => (
              <div key={i} style={{ background: "rgba(59,130,246,0.04)", borderRadius: 8, padding: "14px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#c9d1d9", marginBottom: 2 }}>{s.title}</div>
                <div style={{ fontSize: 10, color: "#6b7280" }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <SecurityNotice />
        <Limitations />
      </div>

      {/* Footer */}
      <div style={{ width: "100%", maxWidth: 640, marginTop: 28, textAlign: "center" }}>
        <div style={{ borderTop: "1px solid #1a1d27", paddingTop: 20 }}>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 6px" }}>
            Hecho por{" "}
            <a href="https://www.linkedin.com/in/abogadolucasvega/" target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 700, fontFamily: "var(--font-display)" }}>Lucas Vega</a>
            {" "}· Abogado Tech
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 8 }}>
            <a href="https://www.lucasvega.com/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#4b5563", textDecoration: "none" }}>🌐 Portfolio</a>
            <a href="https://www.linkedin.com/in/abogadolucasvega/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#4b5563", textDecoration: "none" }}>💼 LinkedIn</a>
          </div>
          <p style={{ fontSize: 10, color: "#1a1d27", margin: "12px 0 0" }}>
            Herramienta gratuita para la comunidad legal · Montecarlo, Misiones 🇦🇷
          </p>
        </div>
      </div>
    </div>
  );
}
