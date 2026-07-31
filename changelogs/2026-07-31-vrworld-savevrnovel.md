# 彼方 saveVRNovel 漏写 — 上传小说 TypeError

**日期**：2026-07-31
**涉及 commit**：（见末尾 git log）

## 改了什么
- 补 `utils/db.ts` 缺失的 `saveVRNovel` 方法（put novel 到 vr_novels store）
- 之前 changelog `2026-07-31-vrworld-missing-db-methods.md` 列了 `getVRNovels` / `deleteVRNovel`，**漏了 `saveVRNovel`**
- `apps/VRWorldApp.tsx:399` 的 onCommit 调 `DB.saveVRNovel(novel)` → 永远抛 `TypeError: F.saveVRNovel is not a function`
- 用户现象：点"上架到书库"按钮 → 弹「处理失败，文件可能太大或格式异常」（这是通用错误文案，跟真实根因无关——容易误导排查方向）

## 动了哪些文件
- `utils/db.ts` —— 在 `getVRNovels` 之后、`deleteVRNovel` 之前，加 `saveVRNovel(novel)` 方法（put 操作）
- `changelogs/2026-07-31-vrworld-savevrnovel.md` —— 本报告

## 踩坑 / 需要知道的（重要）
- **这是 memory 里"schema 创了 method 忘写"隐形炸弹的第 2 次**——上回是"卡 loading"（方法缺失 → reloadAll 抛错 → setLoading 永远不跑），这次是"上传按钮报错"（方法缺失 → saveVRNovel 抛 TypeError）
- **第 1 次教训的盲点**：上回补了 9 个方法，但 changelog 文字只列了 `getVRNovels` / `deleteVRNovel`，没列 `saveVRNovel`——我自己列的方法表就是不可靠的，**必须靠 grep 实际调用点反查**
- **下次防御（更彻底）**：
  1. 加方法前先 `grep -rn "DB\.\w\+" apps components utils | sort -u` 列所有调用
  2. 跟 db.ts 实际定义的方法表对一遍
  3. 缺啥补啥，**不要只信历史 changelog 文字**
- **错误兜底文案要警惕**：UI 的「处理失败，文件可能太大或格式异常」是通用兜底，看到这种文案时**先看 console**，console 的 `[VRWorld] build novel failed F.saveVRNovel is not a function` 才是真凶

## 备注
- 跟 changelog `2026-07-31-vrworld-missing-db-methods.md` 是同一类问题，建议在那个 changelog 顶部加一行「⚠️ 2026-07-31 补：saveVRNovel 也漏了，已在 2026-07-31-vrworld-savevrnovel 修复」
- 这是 SullyOS 项目里"我之前栽过一次的坑又栽了一次"的典型——加完方法时**没回头看调用点全不全**，只看了我自己写的清单
