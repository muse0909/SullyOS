import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { apiKey, baseUrl, text, voice, model } = req.body ?? {};
  if (!apiKey || !text || !voice) return res.status(400).json({ error: 'Missing params' });

  const upstream = await fetch(`${(baseUrl || 'https://api.volink.ai').replace(/\/$/, '')}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: model || 'tts-1', input: text, voice, response_format: 'mp3' }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return res.status(upstream.status).json({ error: errText });
  }

  const buffer = await upstream.arrayBuffer();
  res.setHeader('Content-Type', 'audio/mpeg');
  res.status(200).send(Buffer.from(buffer));
}
