export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { targetUrl, headers: clientHeaders, body } = req.body ?? {};

    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing targetUrl' });
    }

    try {
        const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(clientHeaders || {}),
            },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        });

        const contentType = upstream.headers.get('content-type') || '';
        const rawText = await upstream.text();

        res.setHeader('Content-Type', contentType || 'application/json');
        return res.status(upstream.status).send(rawText);
    } catch (e: any) {
        return res.status(502).json({ error: e.message || 'Proxy failed' });
    }
}
