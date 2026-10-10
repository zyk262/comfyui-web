# 雪间画室 · YUKI / ANIMA

生成随机插画、预览、查看完整图片。浅色毛玻璃界面与动态飘雪，无提示词输入框，无外部字体 CDN 或付费模型 API。

网页：<https://zyk262.github.io/comfyui-web/>。

网页由 GitHub Pages 托管；生成仍由自己的电脑执行。电脑端通过 Cloudflare Quick Tunnel 提供 HTTPS 连接，所有生成与图片接口均需要本地生成的访问口令。

## 手机 / 远程使用

1. 打开 ComfyUI Desktop。
2. 双击 `start-remote.cmd`，保持启动窗口运行。
3. 等待电脑端连接页打开，点击“打开雪间画室”。
4. 手机访问连接页中的私人链接，或复制 `.local/private-link.txt` 中的链接到手机浏览器。

私人链接会在进入网页后自动配置服务地址和口令，并从地址栏清除口令。口令只保存于当前标签页的 sessionStorage。也可点网页右上角“连接画室”手动填写地址和口令。

Quick Tunnel 是免费临时通道，无需购买域名或注册 Cloudflare 账号。每次重启隧道会产生新地址，此时需要使用新的私人链接；不需要重新上传网页。GitHub Pages 网页地址保持不变。Quick Tunnel 用于测试和个人试用，不保证持续在线；固定地址需要另行配置正式通道。

关闭启动窗口会结束远程服务。也可以双击 `stop-remote.cmd` 停止此项目的远程服务；不会停止 ComfyUI Desktop。生成要求电脑开机、ComfyUI 与远程服务在线，工作流所用插件和模型已安装。

远程通道转发生成请求与返回图片，HTTPS 数据经 Cloudflare 中转。它仅连接本项目的桥接服务，不直接公开 ComfyUI 的完整接口。

## 免费发布

公开仓库的 GitHub Pages 使用 GitHub Actions 发布。仓库 Settings → Pages → Source 设置为 GitHub Actions，推送到 main 后自动检查代码并发布 `public/`。

工作流和桥接源代码在仓库中；发布产物只有静态网页。访问口令、私人链接、生成图片、服务状态与 cloudflared 可执行文件都放在 `.local/`，不上传仓库。

## 启动

1. 打开 ComfyUI Desktop，保持服务运行。
2. 双击此文件夹中的 `start.cmd`。需要 Node.js 22 或更高版本，无需 `npm install`。
3. 浏览器打开 <http://127.0.0.1:3210>。
4. 点击“生成一张图片”，生成完成后自动显示；点击“查看图片”查看完整图片。可按 Esc 或右上角 × 关闭预览。

也可以在此目录运行 `node launcher.mjs`。直接运行 `node server.mjs` 只启动桥接服务。关闭启动窗口或按 Ctrl+C 即可停止网页服务；已经提交的 ComfyUI 任务会继续生成。

## 配置

`config.json` 指定 ComfyUI 地址、网页端口、原始工作流、Pages 地址与允许连接的网页来源。默认 ComfyUI 地址为 `http://127.0.0.1:8188`，网页端口为 `3210`。修改允许来源后需要重启桥接服务。

原始 `anima turbo.json` 保持不变。服务每次提交时读取原文件、随机化采样种子。当前原文件的 `AnimaPromptPlusClipEncode` 提示词字段全空，因此服务会在副本中加入同一插件的 `AnimaPromptComposer`，并将其 STRING 输出接到 Plus 节点的 `extra_prompt`。随机抽取画师、角色、服装、背景和姿势，由现有插件在 ComfyUI 中完成，不在网页编造提示词。Composer 使用新的随机种子，避免重复使用缓存。

如果以后在原工作流中连接好自己的随机节点或填入提示词，服务会保留它们，不自动插入 Composer。现有模型、8 步采样、CFG 1、920×1536 分辨率和负面提示词保持原设置。本项目没有加入 NAG。

## 文件

- `public/`：静态网页、样式、飘雪动画和原创 SVG 冬日插画。
- `server.mjs`：Node.js 本地桥接服务。提交任务、读取进度、轮询结果并复制图片到项目目录。
- `workflow.mjs`：工作流适配与结果解析。
- `security.mjs`：访问口令、来源检查与跨域预检处理。
- `launcher.mjs`：启动本地服务 / HTTPS 隧道，创建私人连接页。
- `.github/workflows/pages.yml`：自动检查和部署 GitHub Pages。
- `.local/credentials.json`：访问口令，绝不可提交到公开仓库。
- `.local/connect.html`、`.local/private-link.txt`：电脑和手机的私人访问入口。
- `.local/last-submitted-workflow.json`：最近一次真正提交的 API 工作流，便于排查。
- `.local/images/`：生成图片的本地副本，原图仍保存在 ComfyUI 的输出目录。
- `.local/state.json`：当前任务和最近图片的信息。刷新页面可继续跟踪任务；重启网页服务后可查看最近图片。

`.local/` 已排除 Git 跟踪。网页只显示最近一张图，本地副本会保留，需要时可以手动清理。

## 使用范围

桥接服务只监听 `127.0.0.1`。远程模式通过 cloudflared 转发，API、进度状态与图片都校验访问口令，并限定浏览器来源。本地网页可以在同源、无代理转发的情况下获得本机口令；远程请求无法访问此入口。

当前只提供个人使用的一次一张图、最近图片预览，不包含多用户计费、图库或用户账户。保管好私人链接，它代表访问你的画室的权限。

## 检查

运行 `node --check server.mjs`、`node --check launcher.mjs` 和 `node --check public/app.js` 检查 JavaScript 语法；运行 `node --test tests/*.test.mjs` 检查工作流适配、原文件保护、任务结果解析、口令校验和远程请求限制。启动与测试都不依赖 npm。

参考：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)、[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
