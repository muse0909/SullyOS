import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const getExtFromUrl = (url: string): string => {
    const cleanUrl = url.split('?')[0]?.split('#')[0] || '';
    const ext = cleanUrl.split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'webp') return 'webp';
    if (ext === 'gif') return 'gif';
    return 'png';
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read_blob_failed'));
    reader.readAsDataURL(blob);
});

type SaveRemoteImageResult =
    | { ok: true; mode: 'native-share' | 'web-download' | 'web-share' }
    | { ok: false; reason: 'fetch_failed' | 'share_failed' | 'open_failed' };

export async function saveRemoteImage(url: string, fileName?: string): Promise<SaveRemoteImageResult> {
    const ext = getExtFromUrl(url);
    const finalFileName = fileName || `image_${Date.now()}.${ext}`;

    if (Capacitor.isNativePlatform()) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`http_${res.status}`);
            const blob = await res.blob();
            const dataUrl = await blobToDataUrl(blob);
            await Filesystem.writeFile({
                path: finalFileName,
                data: dataUrl,
                directory: Directory.Cache,
            });
            const uri = await Filesystem.getUri({ directory: Directory.Cache, path: finalFileName });
            await Share.share({
                title: '保存图片',
                files: [uri.uri],
            });
            return { ok: true, mode: 'native-share' };
        } catch {
            return { ok: false, reason: 'fetch_failed' };
        }
    }

    const directLink = document.createElement('a');
    directLink.href = url;
    directLink.download = finalFileName;
    directLink.rel = 'noopener';
    directLink.target = '_blank';
    document.body.appendChild(directLink);
    directLink.click();
    directLink.remove();

    // 跨域图床（img.ai198.top / imgbb 等）浏览器 CORS 拦截直接 fetch，
    // 走后端 /api/proxy-image 绕开 CORS（暮色 2026-07-13 调研后定的方案）。
    const proxiedUrl = '/api/proxy-image?url=' + encodeURIComponent(url);

    try {
        const res = await fetch(proxiedUrl);
        if (!res.ok) throw new Error(`http_${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const blobLink = document.createElement('a');
        blobLink.href = objectUrl;
        blobLink.download = finalFileName;
        document.body.appendChild(blobLink);
        blobLink.click();
        blobLink.remove();
        URL.revokeObjectURL(objectUrl);
        return { ok: true, mode: 'web-download' };
    } catch {
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                const shareOk = await (async () => {
                    try {
                        const res = await fetch(proxiedUrl);
                        if (!res.ok) return false;
                        const blob = await res.blob();
                        const file = new File([blob], finalFileName, { type: blob.type || `image/${ext}` });
                        if (typeof (navigator as any).canShare === 'function' && !(navigator as any).canShare({ files: [file] })) {
                            return false;
                        }
                        await navigator.share({ title: '保存图片', files: [file] });
                        return true;
                    } catch {
                        return false;
                    }
                })();

                if (shareOk) return { ok: true, mode: 'web-share' };
            }

            const opened = window.open(url, '_blank', 'noopener,noreferrer');
            if (opened) return { ok: false, reason: 'fetch_failed' };
            return { ok: false, reason: 'open_failed' };
        } catch {
            return { ok: false, reason: 'share_failed' };
        }
    }
}
