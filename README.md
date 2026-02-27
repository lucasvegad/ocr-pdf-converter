# 🔍 OCR PDF Converter

Herramienta web gratuita que convierte PDFs escaneados en documentos searchable (con texto seleccionable y buscable) usando Google Cloud Vision OCR.

**[→ Probar la herramienta en vivo](https://ocr-pdf-converter.vercel.app)**

---

## ¿Qué problema resuelve?

Si trabajás con documentos legales, administrativos o judiciales escaneados, sabés que no podés buscar texto dentro de ellos. Esta herramienta toma esos PDFs, detecta qué páginas son imágenes, les aplica OCR con Google Cloud Vision, y genera un nuevo PDF donde podés buscar, seleccionar y copiar texto.

## ¿Cómo funciona?

1. **Subís tu PDF** — arrastrando o seleccionando el archivo
2. **Análisis automático** — detecta qué páginas ya tienen texto (las preserva) y cuáles son imágenes escaneadas
3. **OCR con Google Cloud Vision** — procesa solo las páginas que lo necesitan
4. **Descarga** — genera un PDF searchable listo para usar

## Requisitos

Necesitás una API Key gratuita de Google Cloud con Cloud Vision API habilitada. La herramienta incluye una guía paso a paso para obtenerla.

### Obtener tu API Key (5 minutos)

1. Andá a [console.cloud.google.com](https://console.cloud.google.com) y creá un proyecto (o usá uno existente)
2. En el menú lateral → **APIs y Servicios** → **Biblioteca** → buscá "Cloud Vision API" → **Habilitar**
3. Andá a **APIs y Servicios** → **Credenciales** → **Crear credenciales** → **Clave de API**
4. Copiá la clave y pegala en la herramienta

> 💡 Google Cloud Vision ofrece **1,000 requests gratis por mes**. Un PDF de 30 páginas con 15 escaneadas usa solo 15 requests. Te alcanza para ~66 PDFs/mes sin costo.

## Privacidad y seguridad

- **Tu API key nunca se almacena** en ningún servidor. Se usa únicamente en tu navegador durante la sesión.
- **Tus archivos no se suben a ningún servidor propio.** Las imágenes de las páginas escaneadas se envían directamente desde tu navegador a Google Cloud Vision para el OCR.
- **El PDF final se genera localmente** en tu navegador.
- No hay backend, base de datos, ni tracking de ningún tipo.

## Stack técnico

- **Next.js 14** — framework web
- **pdf.js** — lectura y renderizado de PDFs
- **Google Cloud Vision API** — reconocimiento óptico de caracteres
- **jsPDF** — generación del PDF searchable con capa de texto invisible
- **Vercel** — hosting

## Desarrollo local

```bash
git clone https://github.com/tu-usuario/ocr-pdf-converter.git
cd ocr-pdf-converter
npm install
npm run dev
```

Abrí `http://localhost:3000` en tu navegador.

## Deploy en Vercel

1. Hacé fork de este repositorio
2. Andá a [vercel.com/new](https://vercel.com/new)
3. Importá el repo desde GitHub
4. Click en Deploy (Vercel detecta Next.js automáticamente)

No se necesitan variables de entorno. La API key la ingresa cada usuario en el navegador.

## Limitaciones

- La precisión del OCR depende de la calidad del escaneo original
- PDFs con más de 50 páginas escaneadas pueden tardar varios minutos
- El texto invisible superpuesto es funcional para búsqueda pero no tiene posicionamiento pixel-perfect
- Requiere conexión a internet (para las llamadas a Google Cloud Vision)

## Autor

**Lucas Aguilar** — Abogado Tech · Montecarlo, Misiones 🇦🇷

- [LinkedIn](https://www.linkedin.com/in/lucas-aguilar-legaltech/)

Herramienta gratuita para la comunidad legal.

## Licencia

MIT
