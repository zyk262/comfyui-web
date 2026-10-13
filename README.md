# 雪间画室 · YUKI / ANIMA

[固定网页](https://zyk262.github.io/comfyui-web/) · GitHub Pages 托管的浅色毛玻璃画室，动态飘雪，一键生成与完整图片预览。

## 日常使用

1. 打开 ComfyUI Desktop。
2. 双击 `中文启动.cmd`，等待窗口显示 Remote atelier is ready，保持窗口运行。
3. 手机打开固定网页，输入自己的画室密码。无需填写服务地址，无需每次复制私人链接。
4. 选择角色按钮，再点击“生成一张图片”。生成与图片加载期间角色按钮暂时禁用。

程序自动建立 Cloudflare Quick Tunnel，并将新地址更新到仓库的 `runtime` 分支。网页自动查找最新地址。`main` 分支只负责网页和源代码发布，地址更新不会触发 Pages 重新部署。

电脑、ComfyUI 与启动窗口都需要保持运行。关闭服务后无法远程生成；再次启动仍使用同一个网页地址。Quick Tunnel 是免费临时通道，不保证持续在线，无需购买域名。

## 一次性 GitHub 授权

**仅首次需要。** GitHub 插件账户连接用于对话工具，不会给电脑上的独立启动程序提供可持久使用的写入凭据。

双击 `setup-github.cmd`，程序会打开 GitHub 的 fine-grained token 创建页：

1. Repository access 选择 Only select repositories，只选 `comfyui-web`。
2. Repository permissions 只授予 Contents: Read and write；Metadata 的只读权限由 GitHub 自动添加。
3. 设置有效期，点击 Generate token。
4. 将令牌粘贴到电脑端配置窗口后按 Enter。输入不显示；不要将令牌发到聊天或提交到仓库。

该令牌用于自动更新通道地址；权限能够修改此仓库文件，因此应只选这个仓库。令牌经 Windows DPAPI 加密保存在 `.local/github-token.dpapi`，绑定当前 Windows 用户。授权过期或撤销后重新运行配置工具。

程序也可复用已有的 Git 凭据。如果尚未配置，首次双击 `中文启动.cmd` 会提示完成一次性配置。

## 登录与安全

画室密码仅在本机 `.local/login.json` 保存随机盐和 scrypt 哈希，不包含在公开网页、仓库或发现地址文件中。网页不内置密码，也不使用前端比较密码的方式。

密码通过 HTTPS 发送到自己的桥接服务校验。成功后获得有效期 8 小时的随机会话令牌，保存在当前标签页 sessionStorage。后续生成、进度和图片读取都使用令牌；服务重启后需要重新登录。

同一来源 15 分钟内累计 5 次登录失败将暂停尝试；所有来源累计 30 次失败也会限制登录，以降低分布式猜密码风险。保护会造成短暂登录等待，不能完全防止拒绝服务。密码输入框提交后清空。

**短数字密码仍然较弱。** 此项目适合个人使用；公开链接和通道地址不是秘密，知道密码的人能调用生成接口并查看最近图片。长期使用应改为更长的随机密码，不建议公开分享密码。

桥接服务只监听 `127.0.0.1`，远程通道只转发本项目的接口，不直接公开 ComfyUI 的完整接口。浏览器跨域来源只允许自己的 Pages 来源；来源限制不是身份验证的替代。

`.local/` 不上传仓库：包括密码哈希、访问令牌、GitHub 加密凭据、生成图片、运行状态、日志、可执行文件。`runtime/connection.json` 只公开通道地址、在线标记与时间，无密码或令牌。启动后每 8 小时刷新记录，记录 24 小时后过期；异常退出时网页也会根据连接失败提示离线。

HTTPS 请求和返回图片经 Cloudflare 中转。工作流未调用付费生成 API。

## 本地使用与配置

双击 `start.cmd` 在电脑打开本地网页。需要 Node.js 22 或更新版本，无需 npm install。当前电脑已设置画室密码；全新安装需要在本机配置 `.local/login.json` 后启动。

`config.json` 包含 ComfyUI 地址、本地端口、工作流与 GitHub 发现配置。默认 ComfyUI 为 `http://127.0.0.1:8188`，桥接为 `http://127.0.0.1:3210`。

`proxyUrl` 默认 `http://127.0.0.1:7890`。电脑代理在线且 Node.js 支持动态代理时，GitHub 更新与 CLI 下载会通过它，localhost 请求直接连接。代理关闭时使用直连。当前电脑的 Node.js 支持该功能。

网页生成使用 `anima turbo.json`，其中负向提示词固定为 `worst quality, low quality, score_1, score_2, score_3, artist name`。生成接口仅接收角色 ID，从电脑端 `角色.txt` 读取提示词，写入提交副本中 `AnimaPromptPlusClipEncode.character_tags`；`quality_prompt` 固定为用户指定的正向质量提示词。`artist_tags` 固定为 `@naga u, @saku usako \(rabbit\), @tsukiman, @hana kazari, `。通过插件原生 `anima_selector_random` 元数据关闭角色和画师随机，并开启服装、姿势与背景随机。采样种子每次更新，模型、8 步采样、CFG 1、采样器和 920×1536 分辨率保持原设置。

`角色.txt` 每行格式为“中文名称：提示词”。`public/characters.json` 只含网页显示的角色 ID 与名称；增删或重命名角色时需同步此文件并重新发布网页。仅修改已有角色的提示词时，电脑端下一次生成会自动读取。桥接代码更新后需重新启动 `中文启动.cmd`，网页则刷新即可。

随机工作流测试中曾返回噪点图，另一次随机生成及已知参数复测正常。网页按 ComfyUI 实际返回的结果显示，未添加伪造图片或静默替换采样参数。

`stop-remote.cmd` 停止本项目服务，不停止 ComfyUI。已经提交的 ComfyUI 任务仍可能继续执行。

## 发布与检查

Settings → Pages → Source 为 GitHub Actions。推送 main 后，检查代码并仅发布 `public/` 静态网页。

运行 `node --check server.mjs`、`node --check launcher.mjs`、`node --check publisher.mjs`、`node --check public/app.js`，以及 `node --test tests/*.test.mjs`。

参考：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)、[GitHub 仓库文件接口](https://docs.github.com/en/rest/repos/contents)、[Fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
