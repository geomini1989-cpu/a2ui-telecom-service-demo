export async function readNdjson(response: Response, onItem: (item: unknown) => void) {
  if (!response.ok) throw new Error(await response.text());
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onItem(JSON.parse(line));
  }
  if (buffer.trim()) onItem(JSON.parse(buffer));
}
