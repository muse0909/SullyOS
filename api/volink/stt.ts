import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import FormData from 'form-data';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { apiKey, audioBase64, mimeType, model, language } = req.body as any;

  if (!apiKey)      return res.status(400).json({ error: 'apiKey required' });
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 required' });

  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const form   = new FormData();
    form.append('file', buffer, {
      filename:    'recording.webm',
      contentType: mimeType || 'audio/webm',
    });
    form.append('model',    model    || 'FunAudioLLM/SenseVoiceSmall');
    form.append('language', language || 'auto');

    const upstream = await fetch('https://api.volink.ai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...form.getHeaders() },
      body: form,
    });

    const json = await upstream.json();
    return res.status(upstream.status).json(json);
  } catch (e) {
    console.error('[volink/stt proxy]', e);
    res.status(500).json({ error: String(e) });
  }
}
