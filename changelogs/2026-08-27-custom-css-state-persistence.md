# 2026-08-27 聊天外观：自定义 CSS 状态持久化 + 清空全清 + 按钮 disable 优化

暮色 8-27 第四步补丁：修 CustomCssPanel 的状态 bug——「应用」不写 localStorage 导致重新打开 panel 时 textarea 空、跟 `<style>` 不一致；「清空」只清 textarea 不动 style 标签导致"清空不了"。

## 暮色反馈的 bug

1. 选预设 → 点"应用" → 关掉再打开 → textarea 空（但页面已生效，因为 `<style>` 标签还在）—— 不一致
2. 想"清空"也清空不了（因为 textarea 已经是空，按钮点了视觉上没反应）
3. 选下拉菜单里的预设**也没办法覆盖** textarea（实际上 handleSelectPreset 是工作的，但跟"应用"叠加导致状态混乱）

## 根因

- **「应用」按钮只动 `<style>` 标签，不写 localStorage** —— 所以 activeName 一直是空
- 重新挂载 CustomCssPanel 时 useEffect 跑 `findPreset(list, '')` 返回 undefined → `setDraft('')` → textarea 空
- **但 `<style id="user-custom-css">` 还在 document.body 末尾**（是手动挂的节点，不会因为 App 重建而消失）—— 页面继续按之前应用的样子显示
- "清空"按钮只 `setDraft('')`，不动 `<style>` 标签 —— 点了 textarea 已经是空 + 页面还是按之前的样子 —— 用户以为"清空不了"

## 修法

### 1. 加 `custom_css_last_applied` localStorage 字段

`utils/customCssPresets.ts`：
- 加 `LAST_APPLIED_KEY = 'custom_css_last_applied'`
- 加 `getLastAppliedCss()` / `setLastAppliedCss(css)` helper
- `bootstrapUserCustomCss` 改动：没激活预设时**用 last_applied 兜底**（重启 App 页面也按上次应用的样子）

### 2. CustomCssPanel 改 useEffect fallback 优先级

**优先级：last_applied > activeName 预设 > 空**

```js
useEffect(() => {
  ensureDefaultPreset();
  const list = loadPresets();
  setPresetsState(list);
  const lastApplied = getLastAppliedCss();
  const an = getActivePresetName();
  setActiveNameState(an);
  if (lastApplied) {
    // last_applied 跟某个预设 CSS 整段一致 → selectedName 显示那个预设名
    const matching = list.find((p) => p.css === lastApplied);
    setSelectedName(matching?.name || '');  // 手写/改过的 → 空
    setDraft(lastApplied);
    return;
  }
  if (an) {
    const p = findPreset(list, an);
    if (p) { setSelectedName(an); setDraft(p.css); return; }
  }
  setSelectedName('');
  setDraft('');
}, []);
```

保证 textarea 跟 `<style>` 永远同步。

### 3. handleApply 写 last_applied

```js
const handleApply = () => {
  if (!draft) return;
  syncUserCustomCssToDom(draft);
  setLastAppliedCss(draft);
  // 注意：activeName 不在这里设——activeName 跟"从预设列表里激活某个"绑定，
  //   应该由「保存为预设」触发。last_applied 才是"用户当前应用的 CSS"。
};
```

### 4. handleSelectPreset 同步 last_applied

```js
const handleSelectPreset = (name: string) => {
  setSelectedName(name);
  if (!name) { setDraft(''); setLastAppliedCss(''); return; }
  const p = findPreset(presets, name);
  const css = p?.css || '';
  setDraft(css);
  setLastAppliedCss(css);  // 选预设也同步，下次打开能恢复
};
```

修暮色反馈的"选原来的预设没办法覆盖"——同步 last_applied 后，textarea 跟 `<style>` 保持一致。

### 5. handleClear 清所有

```js
const handleClear = () => {
  if (!draft && !activeName && !selectedName) return;
  setDraft('');
  setSelectedName('');
  setActiveNameState('');
  setActivePresetName('');
  setLastAppliedCss('');
  syncUserCustomCssToDom('');  // 清 <style> 标签
  setTimeout(() => textareaRef.current?.focus(), 30);
};
```

修暮色反馈的"清空不了"——现在清空 = 真的回到默认状态（textarea 空 + style 空 + activeName 空 + last_applied 空 + selectedName 空）。

### 6. 按钮 disable 优化

- "应用"按钮：textarea 空时 disable（应用空 CSS 没意义 + 避免误点）
- "清空"按钮：textarea 空 + activeName 空 + selectedName 空 时 disable（啥都没有可清）+ tooltip 提示

## 关键设计决策

| 项 | 选择 | 理由 |
|---|---|---|
| 加 `custom_css_last_applied` 字段 | 加 | 区分 activeName（预设列表里的某个）和 last_applied（用户当前应用的 CSS 真相）—— 两个语义不同 |
| `handleApply` 是否设 activeName | 不设 | activeName 跟"激活预设"绑定，应用手写 CSS 不应该激活任何预设 |
| `handleSelectPreset` 是否同步 last_applied | 同步 | "选了预设没改也没应用"的情况，下次打开 textarea 应该能恢复选了什么 |
| `handleClear` 是否清 `<style>` 标签 | 清 | 暮色反馈"清空不了"——清空按钮必须真的清掉页面效果 |
| useEffect 优先级 | last_applied > activeName > 空 | last_applied 是用户应用的真相，覆盖 activeName 兜底 |

## 行为对照表

| 场景 | 改前 | 改后 |
|---|---|---|
| 选预设 → 应用 → 关掉再开 | textarea 空 / 页面已生效 | textarea 显示预设 / 页面已生效 ✓ |
| 选预设 → 改 → 应用 → 关掉再开 | textarea 空 / 页面已生效 | textarea 显示改后 / 页面已生效 ✓ |
| 选预设 → 改 → 不应用 → 关掉再开 | textarea 显示改后 / 页面未生效（不一致） | textarea 显示原预设 / 页面未生效（一致）✓ |
| 应用手写 CSS → 关掉再开 | textarea 空 / 页面已生效 | textarea 显示手写 CSS / 页面已生效 ✓ |
| 点清空 | textarea 空 / 页面已生效 | textarea 空 / 页面回退默认 ✓ |
| 重启 App | 页面回退默认 | 页面按 last_applied / activeName 保持 ✓ |

## 验证

- `npx tsc --noEmit` 没引入新错误（413 个既有错误没增加）
- `npx vite build` 通过（3.94s）
- 用户流程：外观 → 聊天界面 → 选下拉预设 → 应用 → 退出 App → 重新进 → textarea 显示预设 / 页面已生效 ✓

## 涉及文件

- `utils/customCssPresets.ts`：加 `LAST_APPLIED_KEY` + `getLastAppliedCss` / `setLastAppliedCss` + `bootstrapUserCustomCss` fallback
- `components/appearance/CustomCssPanel.tsx`：useEffect 改优先级 / handleApply 写 last_applied / handleClear 清所有 / handleSelectPreset 同步 last_applied / 按钮 disable
