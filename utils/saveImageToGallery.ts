/**
 * saveImageToGallery.ts — 把图片存进系统相册（2026-10-11）
 *
 * ## 为什么自己写，不直接用 @capacitor-community/media
 *
 * 那个插件存一张图片会在 Android 13+ 上必然报：
 *
 *   Missing the following permissions in AndroidManifest.xml:
 *   android.permission.READ_MEDIA_VIDEO
 *   android.permission.READ_EXTERNAL_STORAGE
 *   android.permission.WRITE_EXTERNAL_STORAGE
 *
 * 两个根因（详细排查见 changelogs/2026-10-11-android-media-permission-fix.md）：
 *
 * 1. 它的 `@CapacitorPlugin` 注解写死了两组权限别名，存图片时调 `requestAllPermissions()`
 *    把**所有别名**并起来一起要 —— 里面包含 READ_MEDIA_VIDEO。**存图片压根用不到视频权限**。
 * 2. 它判定「清单里声明了没」靠 `PackageInfo.requestedPermissions`，而 Android 运行时会过滤掉
 *    `maxSdkVersion` 小于当前系统版本的权限条目，所以清单里明明写了也报「缺失」。
 *
 * ## 现在的做法
 *
 * 自己写的原生插件 `SaveImagePlugin`（android/app/src/main/java/com/aetheros/simulator/SaveImagePlugin.kt）：
 *   - Android 10+：MediaStore + RELATIVE_PATH 写进 `Pictures/SullyOS`，**零权限零弹窗**
 *   - Android 9 及以下：才申请 WRITE_EXTERNAL_STORAGE（maxSdkVersion=28）
 *
 * 「保存自己刚下载的图片」本来就不需要任何读权限 —— 写自己的文件是分区存储明确允许的。
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

interface SaveImageNativePlugin {
    saveImage(options: { uri: string; fileName?: string; mimeType?: string }): Promise<{
        uri: string;
        displayName: string;
        savedVia: string;
        permissionRequired: boolean;
    }>;
}

// 插件名必须跟 SaveImagePlugin.kt 里 @CapacitorPlugin(name = "...") 一致
const SaveImageNative = registerPlugin<SaveImageNativePlugin>('SullySaveImage');

export interface SaveImageResult {
    ok: boolean;
    uri?: string;
    displayName?: string;
    savedVia?: string;
    /** 失败时的具体原因，直接给用户看 */
    reason?: string;
}

export function isSaveImageNativeAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * 把一张已经落在本地的图片存进系统相册。
 *
 * @param uri      图片本地地址。`file://` / `content://` / 裸路径都行。
 * @param fileName 目标文件名，缺省按时间戳生成
 * @param mimeType 图片类型，缺省按扩展名推断
 */
export async function saveImageToGallery(options: {
    uri: string;
    fileName?: string;
    mimeType?: string;
}): Promise<SaveImageResult> {
    if (!isSaveImageNativeAvailable()) {
        return { ok: false, reason: 'not_android：只有安卓原生端能直接写相册' };
    }

    try {
        const saved = await SaveImageNative.saveImage(options);
        return {
            ok: true,
            uri: saved.uri,
            displayName: saved.displayName,
            savedVia: saved.savedVia,
        };
    } catch (e: any) {
        // 老 APK 上还没装这个插件时，registerProxy 会抛 "not implemented"
        // —— 这时候要说人话，别把英文异常直接甩给用户
        const raw = e?.message || String(e) || 'unknown';
        const reason = raw.includes('not implemented')
            ? 'save_plugin_missing：当前安装的包太旧，没有存图插件，请安装最新版本'
            : raw;
        console.warn('[saveImageToGallery] failed:', raw);
        return { ok: false, reason };
    }
}
