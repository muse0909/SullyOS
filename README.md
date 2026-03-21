<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1DiUqAZz4qIDr0G34xUSl5uk2WCx8S2-e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 部署到 GitHub Pages

这个项目已经配置好 GitHub Actions 自动发布（`.github/workflows/deploy-pages.yml`）。

### 一次性设置

1. 把代码推送到 GitHub 仓库的 `main` 或 `master` 分支。
2. 打开仓库 **Settings → Pages**。
3. 在 **Build and deployment** 里选择 **Source: GitHub Actions**。

### 之后怎么发布

- 每次 push 到 `main` 或 `master` 都会自动执行构建并发布。
- 你也可以在 **Actions** 页面手动运行 `Deploy to GitHub Pages`。

### 本地先验证构建

```bash
npm install
npm run build
npm run preview
```

如果发布成功，页面地址通常是：

`https://<你的GitHub用户名>.github.io/<仓库名>/`
