// 麦麦 2026-09-08：图床上传工具(从 useChatAI.ts:2431-2497 提取)
//   之前图床上传逻辑混在 useChatAI 的生图流程里,Modal 也要用就抽出来
//   imgbb 失败自动 fallback Cloudinary,都失败返回 null + 错误信息
//   中间步骤的 toast 由调用方控制(避免弹错时机混乱)

export interface ImageBedConfig {
    imgbbApiKey?: string;
    cloudinaryCloudName?: string;
    cloudinaryUploadPreset?: string;
    r2AccountId?: string;
    r2AccessKeyId?: string;
    r2SecretAccessKey?: string;
    r2Bucket?: string;
    r2PublicUrl?: string;
    // 8-25 暮色 bedKind 字段,记录当前选中的是哪个 tab
    bedKind?: 'imgbb' | 'cloudinary' | 'r2';
}

export interface ImageBedUploadResult {
    ok: boolean;
    url?: string;
    error?: string;
    /** 尝试了哪些图床（按顺序），方便错误信息构造 */
    attempted: Array<'imgbb' | 'cloudinary' | 'r2'>;
}

// b64 上传到 imgbb
async function uploadToImgbb(b64: string, mime: string, apiKey: string): Promise<string | null> {
    try {
        const form = new FormData();
        // imgbb 接受 base64 字符串(不要 data: 前缀)
        const b64NoPrefix = b64.includes(',') ? b64.split(',')[1] : b64;
        form.append('image', b64NoPrefix);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: form,
        });
        const data = await res.json().catch(() => ({} as any));
        if (res.ok && data?.data?.url) {
            return data.data.url;
        }
        return null;
    } catch {
        return null;
    }
}

// b64 上传到 Cloudinary(unsigned upload preset)
async function uploadToCloudinary(b64: string, mime: string, cloudName: string, preset: string): Promise<string | null> {
    try {
        const form = new FormData();
        form.append('file', `data:${mime};base64,${b64}`);
        form.append('upload_preset', preset);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: form,
        });
        const data = await res.json().catch(() => ({} as any));
        if (res.ok && data?.secure_url) {
            return data.secure_url;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * 上传图片到图床（分阶段返回,支持中间步骤 toast）
 *   暮色 9-8 14:50:"imgbb 失败直接弹提醒图床上传失败,实际用时是自动切"
 *   → 加中间步骤 toast 让用户看到完整流程
 */
export interface UploadStageEvent {
    stage: 'imgbb' | 'cloudinary' | 'r2';
    status: 'trying' | 'success' | 'failed';
    reason?: string;
}

export interface ImageBedUploadResult {
    ok: boolean;
    url?: string;
    error?: string;
    attempted: Array<'imgbb' | 'cloudinary' | 'r2'>;
    /** 失败原因分类,用于更精确的 toast */
    reason?: 'no_config' | 'imgbb_failed' | 'cloudinary_failed' | 'all_failed';
}

export async function uploadImageToBed(
    b64OrDataUrl: string,
    mime: string,
    config: ImageBedConfig,
    onStage?: (evt: UploadStageEvent) => void,
): Promise<ImageBedUploadResult> {
    const b64 = b64OrDataUrl.includes(',') ? b64OrDataUrl.split(',')[1] : b64OrDataUrl;
    const attempted: Array<'imgbb' | 'cloudinary' | 'r2'> = [];

    if (!config.imgbbApiKey && !(config.cloudinaryCloudName && config.cloudinaryUploadPreset)) {
        return { ok: false, error: '未配图床', attempted, reason: 'no_config' };
    }

    // 8-25 暮色 bedKind 决定优先用哪个 tab
    const preferImgbb = !config.bedKind || config.bedKind === 'imgbb' || config.bedKind === 'cloudinary';
    const preferCloudinary = config.bedKind === 'cloudinary';

    // 第一阶段
    if (preferImgbb && config.imgbbApiKey) {
        onStage?.({ stage: 'imgbb', status: 'trying' });
        attempted.push('imgbb');
        const url = await uploadToImgbb(b64, mime, config.imgbbApiKey);
        if (url) {
            onStage?.({ stage: 'imgbb', status: 'success' });
            return { ok: true, url, attempted };
        }
        onStage?.({ stage: 'imgbb', status: 'failed' });
    }

    // 第二阶段 Cloudinary
    if (config.cloudinaryCloudName && config.cloudinaryUploadPreset) {
        onStage?.({ stage: 'cloudinary', status: 'trying' });
        attempted.push('cloudinary');
        const url = await uploadToCloudinary(b64, mime, config.cloudinaryCloudName, config.cloudinaryUploadPreset);
        if (url) {
            onStage?.({ stage: 'cloudinary', status: 'success' });
            return { ok: true, url, attempted };
        }
        onStage?.({ stage: 'cloudinary', status: 'failed' });
    }

    // 如果 cloudinary 是首选但还没试 imgbb,补一遍
    if (preferCloudinary && config.imgbbApiKey && !attempted.includes('imgbb')) {
        onStage?.({ stage: 'imgbb', status: 'trying' });
        attempted.push('imgbb');
        const url = await uploadToImgbb(b64, mime, config.imgbbApiKey);
        if (url) {
            onStage?.({ stage: 'imgbb', status: 'success' });
            return { ok: true, url, attempted };
        }
        onStage?.({ stage: 'imgbb', status: 'failed' });
    }

    // 决定 reason
    let reason: ImageBedUploadResult['reason'] = 'all_failed';
    if (attempted.includes('imgbb') && attempted.includes('cloudinary')) {
        reason = 'all_failed';
    } else if (attempted.includes('imgbb')) {
        reason = 'imgbb_failed';
    } else if (attempted.includes('cloudinary')) {
        reason = 'cloudinary_failed';
    }
    return { ok: false, error: `图床都失败（试了 ${attempted.join(' → ')}）`, attempted, reason };
}

/** 从 data URL 里提取 mime,例 data:image/png;base64,xxx → image/png */
export function extractMimeFromDataUrl(dataUrl: string): string {
    const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    return m ? m[1] : 'image/png';
}
