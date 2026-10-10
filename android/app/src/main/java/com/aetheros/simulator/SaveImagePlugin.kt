// SaveImagePlugin — 保存图片到系统相册（2026-10-11）
//
// ## 为什么不用 @capacitor-community/media
//
// 原来 `utils/file.ts` 用 `Media.getAlbums()` + `Media.savePhoto()` 存图，在手机上
// 稳定报这个错：
//
//   Missing the following permissions in AndroidManifest.xml:
//   android.permission.READ_MEDIA_VIDEO
//   android.permission.READ_EXTERNAL_STORAGE
//   android.permission.WRITE_EXTERNAL_STORAGE
//
// 根因是那个插件的两个设计问题叠在一起（详见 changelogs/2026-10-11-android-media-permission-fix.md）：
//
// 1. **它分不清 Android 版本**。插件的 @CapacitorPlugin 注解里写死了两组权限别名：
//        publicStorage     = { READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE }
//        publicStorage13Plus = { READ_MEDIA_IMAGES, READ_MEDIA_VIDEO }
//    savePhoto 发现没权限时调 `requestAllPermissions()`，而那个方法把**所有别名里的
//    所有字符串并起来一起请求**（Plugin.java:444），完全不判断当前 Android 版本。
//    所以**存一张图片也会去要视频读取权限**——这个需求本身从一开始就不存在。
//
// 2. **`maxSdkVersion` 会让权限「查不到」。** Capacitor 判定「清单里有没有声明这个权限」
//    用的是 `PackageInfo.requestedPermissions`（PermissionHelper.getManifestPermissions）。
//    Android 系统在**运行时会过滤掉 maxSdkVersion 小于当前系统版本的权限条目**，它根本不会
//    出现在 requestedPermissions 里。于是清单里明明写了，也会被报成「缺失」：
//        READ_EXTERNAL_STORAGE  maxSdkVersion=32 → Android 13+ 查不到
//        WRITE_EXTERNAL_STORAGE  maxSdkVersion=29 → Android 10+ 查不到
//    再叠上从来没声明过的 READ_MEDIA_VIDEO，就正好是报错里的那三条。
//
// ## 这个插件怎么做的
//
// **Android 10（API 29）及以上：一个权限都不要。**
//   走 MediaStore 插入 + RELATIVE_PATH，把文件写进 `Pictures/SullyOS/`。
//   这是「写入自己创建的文件」——分区存储（scoped storage）明确允许，不需要任何权限，
//   也不需要用户点授权弹窗。不读相册、不枚举相册，所以 READ_MEDIA_IMAGES 同样用不上。
//
// **Android 9（API 28）及以下：需要 WRITE_EXTERNAL_STORAGE。**
//   那时候还没有分区存储，往公共 Pictures 目录写文件必须拿这个权限，所以老老实实
//   在运行时申请（并且清单里标 maxSdkVersion="28"，跟实际需要的系统范围对上）。
//
// 换句话说：权限只在真正需要它的旧系统上要，新系统上一个都不要。

package com.aetheros.simulator

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.InputStream

/**
 * WRITE_EXTERNAL_STORAGE 的别名。
 *
 * 放在**文件顶层**而不是 companion 里 —— 下面 @Permission 注解的参数在类级别求值，
 * 那时候 companion object 还没初始化，引用它的常量会直接编译失败
 * （Unresolved reference: LEGACY_STORAGE_ALIAS）。
 */
private const val LEGACY_STORAGE_ALIAS = "legacyStorage"

/**
 * @Permission 注解只对 Android 9 及以下有意义（WRITE_EXTERNAL_STORAGE 的作用范围）。
 * 声明它是给 [Plugin.requestPermissionForAlias] 用的 —— Capacitor 要求「要申请的权限必须先
 * 在插件注解里登记」。Android 10+ 走 MediaStore 分支，根本不会走到申请这一步，
 * 所以这里声明了也不会在新系统上触发任何弹窗。
 */
@CapacitorPlugin(
    name = "SullySaveImage",
    permissions = [
        Permission(
            strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE],
            alias = LEGACY_STORAGE_ALIAS
        )
    ]
)
class SaveImagePlugin : Plugin() {

    companion object {
        /** 相册里的存放目录（相对 Pictures） */
        private const val ALBUM_NAME = "SullyOS"

        /** 缺扩展名时按 MIME 猜一个 */
        private const val DEFAULT_MIME = "image/jpeg"
    }

    @PluginMethod
    fun saveImage(call: PluginCall) {
        val sourceUri = call.getString("uri")
        if (sourceUri.isNullOrBlank()) {
            call.reject("uri_required：没拿到要保存的图片路径")
            return
        }

        val fileName = sanitizeFileName(call.getString("fileName"))
        val mimeType = call.getString("mimeType")?.takeIf { it.isNotBlank() }
            ?: guessMimeFromName(fileName)

        // Android 10+ —— MediaStore，一个权限都不用
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(call, sourceUri, fileName, mimeType)
            return
        }

        // Android 9 及以下 —— 要 WRITE_EXTERNAL_STORAGE，先看有没有
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED
        ) {
            saveViaLegacyFile(call, sourceUri, fileName, mimeType)
        } else {
            // 没授权：弹窗要一次。授权结果走 permissionCallback 继续往下写。
            // 注意——这次申请只会在 API <= 28 上发生，新系统压根进不来这个分支。
            requestPermissionForAlias(LEGACY_STORAGE_ALIAS, call, "permissionCallback")
        }
    }

    /**
     * Android 10+：MediaStore 插入。
     *
     * 关键点是 `IS_PENDING`：先占位（其它 App 看不到半张图），写完再置 0 放出来。
     * 中途失败要把占位删掉，否则相册里会留下一条空记录。
     */
    private fun saveViaMediaStore(call: PluginCall, sourceUri: String, fileName: String, mimeType: String) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Images.Media.MIME_TYPE, mimeType)
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$ALBUM_NAME")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }

        val target: Uri = try {
            resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("MediaStore.insert 返回空")
        } catch (e: Exception) {
            call.reject("mediastore_insert_failed：${e.message}")
            return
        }

        try {
            openSource(sourceUri).use { input ->
                resolver.openOutputStream(target)?.use { output ->
                    input.copyTo(output)
                } ?: throw IllegalStateException("打不开目标输出流")
            }
        } catch (e: Exception) {
            // 写失败：把占位记录清掉，别在相册里留空文件
            try { resolver.delete(target, null, null) } catch (_: Exception) {}
            call.reject("write_failed：${e.message}")
            return
        }

        // 写完了，把 pending 置 0 让系统相册能看到
        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(target, values, null, null)

        val result = JSObject()
        result.put("uri", target.toString())
        result.put("displayName", fileName)
        result.put("savedVia", "MediaStore")
        result.put("permissionRequired", false)
        call.resolve(result)
    }

    /**
     * Android 9 及以下：直接写公共 Pictures 目录，然后通知系统媒体库扫一下。
     * （没有 MediaStore RELATIVE_PATH，得手动 scanFile 相册才会刷新出来）
     */
    private fun saveViaLegacyFile(call: PluginCall, sourceUri: String, fileName: String, mimeType: String) {
        try {
            val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
            val albumDir = File(picturesDir, ALBUM_NAME)
            if (!albumDir.exists() && !albumDir.mkdirs()) {
                call.reject("mkdir_failed：建不了 $albumDir")
                return
            }

            val target = uniqueFile(albumDir, fileName)
            openSource(sourceUri).use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }

            MediaScannerConnection.scanFile(
                context,
                arrayOf(target.absolutePath),
                arrayOf(mimeType),
                null
            )

            val result = JSObject()
            result.put("uri", Uri.fromFile(target).toString())
            result.put("displayName", target.name)
            result.put("savedVia", "legacy_file")
            result.put("permissionRequired", true)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("legacy_write_failed：${e.message}")
        }
    }

    /**
     * WRITE_EXTERNAL_STORAGE 的授权回调 —— 只有 Android 9 及以下会走到这里。
     * requestPermissionForAlias 会把 call 存下来，所以参数还在，直接接着写。
     */
    @PermissionCallback
    fun permissionCallback(call: PluginCall) {
        val sourceUri = call.getString("uri")
        if (sourceUri.isNullOrBlank()) {
            call.reject("uri_required：权限回调时丢了图片路径")
            return
        }

        if (getPermissionState(LEGACY_STORAGE_ALIAS) != PermissionState.GRANTED) {
            call.reject("storage_permission_denied：用户没给存储权限，存不了")
            return
        }

        val fileName = sanitizeFileName(call.getString("fileName"))
        val mimeType = call.getString("mimeType")?.takeIf { it.isNotBlank() }
            ?: guessMimeFromName(fileName)
        saveViaLegacyFile(call, sourceUri, fileName, mimeType)
    }

    // ==================== 工具方法 ====================

    /**
     * 打开源文件。前端传过来的一般是 Filesystem.getUri 拿的 `file://`，
     * 但 content:// 和裸路径也得能处理，不然以后换调用方会踩坑。
     */
    private fun openSource(sourceUri: String): InputStream {
        return when {
            sourceUri.startsWith("content://") -> context.contentResolver.openInputStream(Uri.parse(sourceUri))
                ?: throw IllegalStateException("打不开 content 地址：$sourceUri")

            sourceUri.startsWith("file://") -> File(Uri.parse(sourceUri).path!!).inputStream()

            else -> File(sourceUri).inputStream()
        }
    }

    /** 文件名清洗：去掉路径分隔符（防止 ../ 逃逸），空名给个兜底，缺扩展名补一个 */
    private fun sanitizeFileName(raw: String?): String {
        var name = raw?.substringAfterLast('/')?.substringAfterLast('\\')?.trim().orEmpty()
        if (name.isEmpty() || name == "." || name == "..") {
            name = "sully_${System.currentTimeMillis()}.jpg"
        }
        // 文件名里带上路径分隔符的话，相册那边会当成子目录，这里拦掉
        name = name.replace("/", "_").replace("\\", "_")
        if (!name.contains('.')) {
            name = "$name.jpg"
        }
        return name
    }

    private fun guessMimeFromName(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "heic", "heif" -> "image/heic"
            else -> DEFAULT_MIME
        }
    }

    /** 旧系统写文件不会自动重名，自己找一个不冲突的（跟系统相册一致：图(1).jpg） */
    private fun uniqueFile(dir: File, name: String): File {
        var candidate = File(dir, name)
        if (!candidate.exists()) return candidate

        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var index = 1
        while (candidate.exists()) {
            candidate = File(dir, "$base($index)$ext")
            index++
        }
        return candidate
    }
}
