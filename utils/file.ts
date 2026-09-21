
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Media } from '@capacitor-community/media';

export const processImage = (file: File, options?: { maxWidth?: number, quality?: number, forceJpeg?: boolean, skipCompression?: boolean }): Promise<string> => {
    return new Promise((resolve, reject) => {
        // 简单验证
        if (!file.type.startsWith('image/')) {
            reject(new Error('请上传图片文件'));
            return;
        }

        // 1. 如果开启了 skipCompression (用于壁纸等)，直接读取原文件返回，不经过Canvas重绘
        if (options?.skipCompression) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = (e) => reject(new Error('文件读取失败'));
            return;
        }

        // GIF 不压缩直接读取（放宽限制至 50MB）
        if (file.type === 'image/gif') {
            if (file.size > 50 * 1024 * 1024) {
                reject(new Error('GIF 图片过大(>50MB)，可能导致应用崩溃'));
                return;
            }
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = (e) => reject(e);
            return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                // 压缩逻辑
                // 默认 1200 (高画质)，如果传入 options 则使用传入值 (如 Chat 中传 600)
                const MAX_WIDTH = options?.maxWidth || 1200; 
                const MAX_HEIGHT = MAX_WIDTH; // 保持比例限制
                
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas context error'));
                    return;
                }
                
                // 清空画布 (保证透明)
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                
                // 智能格式选择: 
                // 1. 如果 forceJpeg 为 true (如聊天发送图)，强制转 JPEG 以节省体积
                // 2. 否则如果原图是 PNG/WebP，保持格式以保留透明通道 (如立绘、贴纸)
                // 3. 默认 JPEG
                let mimeType = 'image/jpeg';
                if (!options?.forceJpeg && (file.type === 'image/png' || file.type === 'image/webp')) {
                    mimeType = file.type;
                }
                
                // 质量控制: 默认 0.85，传入值优先
                const quality = options?.quality || 0.85;
                
                const dataUrl = canvas.toDataURL(mimeType, quality);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(new Error('图片加载失败'));
        };
        reader.onerror = (err) => reject(new Error('文件读取失败'));
    });
};

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
    | { ok: true; mode: 'native-saved' | 'web-download' | 'web-share' }
    | { ok: false; reason: 'fetch_failed' | 'save_failed' | 'share_failed' | 'open_failed' };

export async function saveRemoteImage(url: string, fileName?: string): Promise<SaveRemoteImageResult> {
    const ext = getExtFromUrl(url);
    const finalFileName = fileName || `image_${Date.now()}.${ext}`;

    if (Capacitor.isNativePlatform()) {
        // 暮色 9-21 第五轮 + 第六轮:不再调 Share.share 弹分享框,直接写入相册
        //   - 用 @capacitor-community/media 插件的 Media.savePhoto
        //   - 先 fetch 拿到图片 → 写临时文件到 Cache
        //   - **重要**:savePhoto 必须传 albumIdentifier(系统相册某个目录的绝对路径)
        //     不传直接 reject "Album identifier required"。需要先 getAlbums() 拿列表
        //   - 取第一个 album(通常是默认相机相册)的 identifier
        //   - 保存成功 → toast \"已保存到相册\";失败 → toast 错误原因
        //   - 整个替换掉 Share.share 调用
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

            // 暮色 9-21 第七轮关键修复:savePhoto 必须传 albumIdentifier
            //   先 getAlbums() 拿到系统相册列表,取第一个(通常是默认相册 Pictures)
            //   getAlbums 本身需要 READ 权限(Android 13+ READ_MEDIA_IMAGES)
            //   没有权限时插件会自动 requestAllPermissions 弹窗,用户授权后才能拿到列表
            const albumsResult = await Media.getAlbums();
            const albums = (albumsResult as any).albums || [];
            if (albums.length === 0) {
                throw new Error('no_album_available');
            }
            const albumIdentifier = albums[0].identifier as string;

            await Media.savePhoto({ path: uri.uri, albumIdentifier });
            return { ok: true, mode: 'native-saved' };
        } catch (e: any) {
            // 暮色 9-21 第七轮改进:把真实错误原因传给 UI,不再统一显示"检查相册权限"
            //   - 用户能看到具体是"没相册"还是"权限被拒"还是其他
            const errMsg = e?.message || String(e) || 'unknown';
            console.warn('[saveRemoteImage] save photo to album failed:', errMsg);
            return { ok: false, reason: 'save_failed', detail: errMsg };
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
