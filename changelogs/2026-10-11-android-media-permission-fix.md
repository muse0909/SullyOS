# 保存图片报「Missing the following permissions」— 换掉 Media 插件改走 MediaStore

**日期**：2026-10-11
**涉及 commit**：`3378d179`

## 改了什么

暮色反馈：拾光机 APK 上保存图片时报错，点一下就弹出来：

```
Missing the following permissions in AndroidManifest.xml:

android.permission.READ_MEDIA_VIDEO
android.permission.READ_EXTERNAL_STORAGE
android.permission.WRITE_EXTERNAL_STORAGE
```

**没往清单里补权限**（补了也只是把 bug 盖住，下次 Android 大版本一到照样炸）。
改成从根上换掉存图实现：自己写原生插件，Android 10+ 走 MediaStore，**一个权限都不用**。

1. **新增 `SaveImagePlugin.kt`**（原生 Capacitor 插件）
   - Android 10（API 29）+：MediaStore 插入 + `RELATIVE_PATH`，写进 `Pictures/SullyOS/`，**零权限零弹窗**
   - Android 9（API 28）−：才申请 `WRITE_EXTERNAL_STORAGE`（清单里 `maxSdkVersion="28"`），写完调 `MediaScannerConnection` 让相册刷新
2. **清单权限收敛**：删掉 `READ_EXTERNAL_STORAGE`、`READ_MEDIA_IMAGES`，`WRITE_EXTERNAL_STORAGE` 的 `maxSdkVersion` 从 29 收紧到 28
3. **移除 `@capacitor-community/media` 依赖**（`package.json` + `npx cap sync android`）
4. **`utils/file.ts`** 的 `saveRemoteImage` 改调新插件；**`utils/saveImageToGallery.ts`** 是前端封装
5. **`ChatModals.tsx`** 错误提示跟着改（下面有个分支现在是死代码，删了）

---

## 踩坑 / 需要知道的（重要）

### 一、`READ_MEDIA_VIDEO` 是插件自己要的，不是我们代码写的

全仓 grep 不到 `READ_MEDIA_VIDEO`（除插件二进制）。它来自
`@capacitor-community/media` 的 `@CapacitorPlugin` 注解 —— 那插件声明了**两组**权限别名：

```java
publicStorage      = { READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE }
publicStorage13Plus = { READ_MEDIA_IMAGES,      READ_MEDIA_VIDEO      }
```

`savePhoto` 发现没权限就调 `requestAllPermissions()`，而那个方法
（`Plugin.java:444`）把**所有别名里的所有字符串并起来一起请求**：

```java
for (Permission perm : annotation.permissions()) {
    perms.addAll(Arrays.asList(perm.strings()));   // 不判断当前 Android 版本
}
```

所以**存一张图片也会去要视频读取权限**。这个需求从一开始就不存在 —— 插件压根没做版本分流。

### 二、`maxSdkVersion` 会让权限「查不到」，被误报成缺失

这条最隐蔽，光看清单文件**完全看不出来**。

Capacitor 判断「清单里有没有声明某权限」用的是
`PermissionHelper.getManifestPermissions()` → `PackageInfo.requestedPermissions`。
而 **Android 运行时会过滤掉 `maxSdkVersion` 小于当前系统版本的权限条目**，它压根不会出现在
`requestedPermissions` 里。

原清单写的是：

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
```

于是暮色的手机上（Android 13+）：

| 权限 | 清单里 | Android 13+ 实际 | 结果 |
|---|---|---|---|
| `READ_EXTERNAL_STORAGE` | max 32 | **被过滤，查不到** | 报缺失 |
| `WRITE_EXTERNAL_STORAGE` | max 29 | **被过滤，查不到** | 报缺失 |
| `READ_MEDIA_VIDEO` | 压根没声明 | 没有 | 报缺失 |

三条对上报错原文。**`maxSdkVersion` 用得对，只是 Capacitor 的检测方式配不上它** ——
但反过来想：我们压根就不需要这两个权限，所以正确的解法是删掉，不是把 `maxSdkVersion` 调大。

### 三、原来那个 `getAlbums()` 是纯多余

原代码 `saveRemoteImage` 是这样存的：

```ts
const albumsResult = await Media.getAlbums();      // 要 READ 权限才能枚举相册
const albumIdentifier = albums[0].identifier;
await Media.savePhoto({ path: uri.uri, albumIdentifier });
```

`savePhoto` 强制要传 `albumIdentifier`（不传直接 reject），所以不得不先枚举相册 ——
**而「枚举用户相册」正是需要读权限的那一步**。于是为了存一张自己刚下载的图，
被迫去读用户的整个相册。

真相是：**写入自己创建的文件，分区存储明确允许，不需要任何权限，也不需要知道任何相册 id。**
Android 10+ 直接 `MediaStore.insert` + `RELATIVE_PATH` 就完事。

### 四、保留的只有 `WRITE_EXTERNAL_STORAGE`（maxSdkVersion=28）

Android 9 及以下没有分区存储，往公共 Pictures 写文件确实必须拿这个权限 —— 这是真实需求，
不是凑数。所以保留了，但 `maxSdkVersion` 收紧到 28（跟实际需要的系统范围对齐）。
从 29 收紧是因为 Android 10 起用 MediaStore 分支，这个权限彻底用不上了。

### 五、`registerPlugin` 的位置

`SaveImagePlugin` 注册在 `MainActivity.onCreate` 里（跟 `PhoneUsagePlugin` / `KeepAlivePlugin` /
`AmsgUnifiedPushPlugin` 一样）。**app 自己的模块**里的插件不会被 Capacitor 自动发现，
必须在 `MainActivity` 显式 `registerPlugin(...)`，漏了的话前端 `registerPlugin('SullySaveImage')`
拿到的是空 proxy，调用时报 `not implemented`。
（`utils/saveImageToGallery.ts` 里已经把这种情况翻译成「安装包太旧」了。）

### 六、依赖必须 `npx cap sync` 才真的删掉

只删 `package.json` 是不够的。`android/app/capacitor.build.gradle` 和
`android/capacitor.settings.gradle` 里还留着 `implementation project(':capacitor-community-media')`，
而那个文件头写着「DO NOT EDIT! GENERATED EACH TIME」，不 sync 直接 `./gradlew` 会挂在找不到 project。

### 七、`@Permission` 注解里不能引用 companion object 的常量

第一次编译直接挂了：

```
e: SaveImagePlugin.kt:76:21 Unresolved reference: LEGACY_STORAGE_ALIAS
```

`@CapacitorPlugin(permissions = [...])` 的参数在**类级别**求值，那时 companion object
还没初始化，拿不到它的 `const val`。解法是把这个别名常量提到**文件顶层**
（`private const val LEGACY_STORAGE_ALIAS = "legacyStorage"`），
类内部照样能直接用 —— 类的成员访问文件级常量没问题。

顺带一提：AGENTS.md 说的「组件不许写在函数体里」是同一种直觉的另一面 ——
**求值时机**。类注解 / 静态初始化块 / 顶层属性引用，都得想一下「这时候伴生对象在不在」。

---

## 动了哪些文件

| 文件 | 改了什么 |
|---|---|
| `android/app/src/main/java/com/aetheros/simulator/SaveImagePlugin.kt` | **新增**。原生存图插件，MediaStore / 旧系统文件两条路 |
| `android/app/src/main/java/com/aetheros/simulator/MainActivity.java` | 加一行 `registerPlugin(SaveImagePlugin.class)` |
| `android/app/src/main/AndroidManifest.xml` | 删 `READ_EXTERNAL_STORAGE`、`READ_MEDIA_IMAGES`；`WRITE_EXTERNAL_STORAGE` 的 max 从 29 → 28 |
| `utils/saveImageToGallery.ts` | **新增**。前端封装 + 老 APK 兜底提示 |
| `utils/file.ts` | `saveRemoteImage` 改调新插件；删 `getAlbums()` 那段和 Media import |
| `components/chat/ChatModals.tsx` | 删死分支「没有可用相册」（插件不再枚举相册了），加「安装包太旧」提示 |
| `package.json` / `package-lock.json` | 移除 `@capacitor-community/media` |
| `android/app/capacitor.build.gradle`、`capacitor.settings.gradle`、`capacitor.plugins.json` | `npx cap sync android` 的产物 |

**没动的**：UnifiedPush / UnifiedPushService / AmsgUnifiedPushPlugin / KeepAliveService /
MainActivity 里其余注册逻辑 —— 一个字没改。

---

## 怎么验证

```bash
# 1. 前端构建
npm run build          # ✓ 通过

# 2. 类型检查（全量有 381 条历史遗留错，只看有没有新增）
npx tsc --noEmit 2>&1 | grep -E "saveImageToGallery|utils/file\.ts"
# utils/file.ts(155,56) 的 detail 那条是**改动前就有的**（HEAD 里在 159 行），不是这次引入的

# 3. 编译 APK
cd android && ./gradlew assembleDebug
```

**核对最终合并后的清单**（关键，看这个而不是看源码清单）：

```bash
cd android
./gradlew processDebugMainManifest   # 或直接看 assembleDebug 的产物
grep -oE 'android:maxSdkVersion="[0-9]+"|<uses-permission android:name="android\.permission\.[A-Z_]+"' \
  app/build/intermediates/merged_manifests/debug/AndroidManifest.xml
```

期望结果 —— **不再有** `READ_EXTERNAL_STORAGE` / `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`：

```
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
...（录音 / 保活 / 推送那些原封不动）
```

**手机上实测**：暮色装上新包 → 主聊天里对一张角色图长按保存 →
应该直接存进 `Pictures/SullyOS/`，**全程一个权限弹窗都不出现**（Android 10+）。

---

## 备注

### ⚠️ 这个改动**必须合到 master 并部署成功**，手机上才会生效

`capacitor.config.json` 里配了 `server.url = https://sully-muse-vert.vercel.app`，
Capacitor 有这个配置就会**从线上加载网页**，APK 里那份本地 bundle 根本不参与。

所以这次改动是**一半在 APK、一半在线上**：

| 部分 | 在哪 | 怎么生效 |
|---|---|---|
| `SaveImagePlugin`（原生插件） | APK 里的 `classes4.dex` | 装新 APK 就有 |
| `saveImageToGallery` + `file.ts` 改调用 | 前端 JS bundle | **要 master 部署成功** |

→ 光推 `preview` 分支，手机上的主 app **看不到任何变化**（它加载的是 master 的部署）。
要么合 master 一起上，要么临时用测试包（`-PtestBuild`，加载 fix 分支部署）验证。

### 其他

- **旧包升上来不用管权限**：清过相册权限的用户重装/升级后不用重新授权，因为新版本压根不要了。
- **Android 9 及以下**（`minSdkVersion=22`，理论支持但没人测过）：会弹一次存储授权。
  这条路**没在真机上验证过**，暮色手机是 Android 16，不在这条路径上。
- 存图路径固定在 `Pictures/SullyOS/`，跟系统默认 `Pictures/` 分开，以后用户翻相册好找。
