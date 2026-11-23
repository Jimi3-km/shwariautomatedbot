import zlib from 'node:zlib';

/**
 * A one-page PDF holding a rendered document.
 *
 * Invoices and receipts are drawn once, as SVG, so the picture in chat, the
 * email and the PDF are the same document. This wraps the rendered pixels in
 * the smallest valid PDF: one page, sized to the document, with the image
 * filling it. No PDF library is needed for that, which keeps the serverless
 * function small and its output identical everywhere.
 *
 * The page is A4 wide (595 points). A long document makes a taller page rather
 * than being squeezed, so nothing is ever cut off.
 */
export function pixelsToPdf(rgba: Uint8Array, width: number, height: number, title = 'Document'): Buffer {
  // PDF images have no alpha here; flatten onto white.
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
    const a = rgba[i + 3] / 255;
    rgb[j] = Math.round(rgba[i] * a + 255 * (1 - a));
    rgb[j + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
    rgb[j + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
  }
  const image = zlib.deflateSync(rgb, { level: 9 });

  const pageW = 595;
  const pageH = Math.round((pageW * height) / width * 100) / 100;
  const content = Buffer.from(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`, 'latin1');
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '').slice(0, 80) || 'Document';

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>', 'latin1'),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`, 'latin1'),
      image,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.from(`<< /Title (${safeTitle}) /Producer (Shwari) >>`, 'latin1'),
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(obj);
    length += obj.length;
  });

  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
