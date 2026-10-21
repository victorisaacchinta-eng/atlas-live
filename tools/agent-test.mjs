// Fake Token Factory: first turn asks for a web search and a focus, second turn answers.
import http from 'node:http';
let turn = 0;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = JSON.parse(b); turn++;
    const msg = turn === 1
      ? { role: 'assistant', content: '', tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'Perseverance rover wheels' }) } },
          { id: 'c2', type: 'function', function: { name: 'focus_part', arguments: JSON.stringify({ index: 4 }) } } ] }
      : { role: 'assistant', content: '<think>x</think>Each wheel is machined aluminium with titanium spokes.' };
    if (turn === 2) console.log('turn2 saw tool msgs:', body.messages.filter((m) => m.role === 'tool').map((m) => m.name).join(','));
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: msg }] }));
  });
});
srv.listen(8787, async () => {
  process.env.TOKEN_FACTORY_URL = 'http://localhost:8787';
  process.env.NEBIUS_API_KEY = 'test';
  const { default: handler } = await import('../api/ask.ts');
  await handler({ method: 'POST', body: { question: 'what are the wheels made of', machine: 'Perseverance rover', parts: ['Mast', 'Arm', 'Body', 'Wheels'] } },
    { status: (n) => ({ json: (j) => { console.log(n, JSON.stringify(j)); srv.close(); } }) });
});
