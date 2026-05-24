export default async function handler(req: any, res: any) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, audioBase64, mimeType, model, language } = req.body ?? {};

  if (!apiKey || !audioBase64) {
    return res.status(400).json({ error: 'Missing apiKey or audioBase64' });
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const blob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });

  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  form.append('model', model || 'FunAudioLLM/SenseVoiceSmall');
  if (language && language !== 'auto') form.append('language', language);

  const upstream = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return res.status(upstream.status).json({ error: errText });
  }

  const data = await upstream.json();
  return res.status(200).json({ text: data.text ?? '' });
}
