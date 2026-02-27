export const metadata = {
  title: 'OCR PDF Converter — Herramienta gratuita para abogados',
  description: 'Convierte PDFs escaneados en documentos searchable con OCR. Herramienta gratuita creada por Lucas Aguilar, Abogado Tech.',
  openGraph: {
    title: 'OCR PDF Converter — Herramienta gratuita para abogados',
    description: 'Convierte PDFs escaneados en documentos searchable con OCR de Google Cloud Vision. 100% gratuito.',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  )
}
