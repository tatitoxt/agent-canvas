/** Minimal PDF writer — Helvetica, multi-page, no compression, no deps.
 * Latin-1 only: anything else is transliterated/stripped. */

const esc = (s: string) =>
  s
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
    .replace(/[\\()]/g, (c) => "\\" + c);

export function buildPdf(title: string, lines: string[]): Uint8Array {
  const wrapped: string[] = [];
  for (const l of [title.toUpperCase(), "", ...lines]) {
    let s = l;
    if (!s) { wrapped.push(""); continue; }
    while (s.length > 88) {
      let cut = s.lastIndexOf(" ", 88);
      if (cut < 40) cut = 88;
      wrapped.push(s.slice(0, cut));
      s = "    " + s.slice(cut).trimStart();
    }
    wrapped.push(s);
  }

  const perPage = 52;
  const pageTexts: string[] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(wrapped.length / perPage)); i++) {
    const chunk = wrapped.slice(i * perPage, (i + 1) * perPage);
    pageTexts.push(chunk.map((l) => `(${esc(l)}) Tj T*`).join("\n"));
  }

  // Object layout: 1 catalog, 2 pages, 3 font, then per page: page, content
  const objs: string[] = [];
  const nPages = pageTexts.length;
  const pageObjIds = Array.from({ length: nPages }, (_, i) => 4 + i * 2);
  objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[1] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${nPages} >>`;
  objs[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageTexts.forEach((stream, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    objs[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const body = `BT /F1 10 Tf 14 TL 54 740 Td\n${stream}\nET`;
    objs[contentId - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets[i] = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${o.toString().padStart(10, "0")} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Simple md → text lines for the PDF: headings stay, markup stripped. */
export function mdToLines(md: string): string[] {
  return md.split("\n").map((l) =>
    l
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
  );
}

export function downloadPdf(title: string, md: string) {
  const bytes = buildPdf(title, mdToLines(md));
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w-]+/g, "-").slice(0, 60) || "doc"}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
