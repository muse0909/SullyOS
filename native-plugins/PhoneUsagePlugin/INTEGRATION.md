# PhoneUsagePlugin 集成指南

暮色 2026-08-26 项目"角色查手机" P0 第 1 步配套。

## 文件清单

```
native-plugins/PhoneUsagePlugin/
├── android/
│   └── PhoneUsagePlugin.kt    插件主文件（~330 行）
└── INTEGRATION.md             本文档
```

## 何时做这个集成

- 跑过 `npx cap add android`（已生成 `android/` 目录）
- 在 Android Studio 打开 `android/` 工程能正常编译

## 集成步骤（3 步）

### 1. 拷贝插件文件

```bash
# package 路径跟 MainActivity 同 package = com.aetheros.simulator
cp native-plugins/PhoneUsagePlugin/android/PhoneUsagePlugin.kt \
   android/app/src/main/java/com/aetheros/simulator/
```

**package 名必须匹配 MainActivity**（`com.aetheros.simulator`）。改过 package 名的话同步改 Kotlin 文件 `package` 行。

### 2. 在 MainActivity 注册插件

打开 `android/app/src/main/java/com/aetheros/simulator/MainActivity.java`（或 `.kt`），找到 `onCreate` 里的 `registerPlugin` 调用，**追加**：

Java 写法：
```java
import com.aetheros.simulator.PhoneUsagePlugin;
...
registerPlugin(PhoneUsagePlugin.class);
```

Kotlin 写法：
```kotlin
import com.aetheros.simulator.PhoneUsagePlugin
...
registerPlugin(PhoneUsagePlugin::class.java)
```

### 3. AndroidManifest **不需要**加权限

`PACKAGE_USAGE_STATS` 是特殊权限，**不能**在 `AndroidManifest.xml` 里申请。运行时通过 `requestPermission()` 跳系统设置页让用户手动开。

---

## 验证编译

Android Studio → Build → Make Project。

预期：
- ✅ 编译通过
- ⚠️ 如果报 "Unresolved reference: usageStatsManager" 之类 → 检查 import 路径（`com.getcapacitor.*` 和 `android.app.usage.*`）

---

## 验证运行时

启动 app 到 SullyOS web 端，Console 跑：

```js
const { Capacitor } = window;

// 1. 检查权限
const p = await Capacitor.Plugins.PhoneUsage.checkPermission();
console.log(p);  // { granted: false }  (未开权限)

// 2. 跳设置页
await Capacitor.Plugins.PhoneUsage.requestPermission();
// 手动在系统设置里 → 隐私 → 使用情况访问 → 勾上 SullyOS

// 3. 再查
const p2 = await Capacitor.Plugins.PhoneUsage.checkPermission();
console.log(p2);  // { granted: true }

// 4. 试调数据
const cur = await Capacitor.Plugins.PhoneUsage.getCurrentApp();
console.log(cur);  // { packageName: 'com.android.chrome', appName: 'Chrome', timestamp: 1724... }
```

---

## 已知坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `SecurityException` 抛错 | `PACKAGE_USAGE_STATS` 没开 | 走权限引导流程 |
| `getCurrentApp` 报"未检测到最近的前台 app" | 最近 60 秒内无应用切换 | 切走再切回试试 |
| `getAppUsageToday` 数据全是 0 | 新装/系统重置后第一天没数据 | 等第二天 |
| 时长不准（少几分钟） | 系统 UsageStats 本身有统计粒度限制（分钟级） | 接受，不修 |
| 鸿蒙系统不工作 | 鸿蒙有自己的 `usageStats` 不兼容 Android API | 不支持，提示用户 |
| 编译报 "Type UsageStats is never used" | import 了但没用 | 删 import |

---

## P0 第 1 步只做这俩

- Kotlin 插件 + 集成文档 ← **本 commit**

## 后续 commit 计划

- **commit 2**：前端 Capacitor 桥（TS 调原生）+ `get_phone_usage` 工具 schema + useChatAI dispatch（`current_app` 链路，mock 数据先跑通）
- **commit 3**：扩展 4 个 type（usage_today / screen_time / recent_apps）+ 设置页 toggle + 权限引导 UI
- **commit 4**：AI prompt 补充（P1）
- **P2（下周）**：持续监听 + 阈值主动关心（独立 service 思路）

---

## 关联

- 项目根 `changelogs/2026-08-26-phone-usage-p0-step1.md` 详细记录这次改动
- `utils/phoneUsage.ts`（commit 2 落地）会封装 Capacitor 桥，前端不直接调 `Capacitor.Plugins.PhoneUsage.*`
