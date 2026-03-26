function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const dataBase64 = uint8ToBase64(new Uint8Array(buffer));

  const res = await fetch('/api/extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, dataBase64 }),
  });

  let payload: { text?: string; extracted?: boolean; error?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // ignore JSON parse error
  }

  if (!res.ok) {
    throw new Error(payload.error || `PDF extraction failed (${res.status})`);
  }

  return payload.extracted ? (payload.text || '') : '';
}
