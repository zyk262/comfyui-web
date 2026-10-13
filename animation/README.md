# 雪间画室 · Remotion 抽卡动画

src/GachaDraw.tsx 为网页实际使用的 Remotion 动画：900×600、60 fps、600 帧（10 秒）。卡带展开、透视移动、三次抽取、弹簧落位、粒子和扫光全部由 useCurrentFrame() 驱动。

src/Root.tsx 注册 Studio 合成，src/player.tsx 将相同合成嵌入静态网页。网页负责生成与图片解码，Player 负责播放；三张图片和 10 秒动画均完成后再统一翻牌。减少动态效果的系统设置会跳过抽卡过程。

## 编辑与构建

在此目录运行 npm ci，然后运行 npm run dev -- --no-open。
打开终端给出的 Studio 地址，选择 GachaDraw，可逐帧检查或预览。

修改后运行 npm run lint、npm run build:player 和 node ../stamp-assets.mjs。

生成的 ../public/remotion-player.js 包含 React、Remotion Player 和合成代码，无外部 CDN。普通使用只需运行项目的 启动.cmd；不需要在桥接服务启动时安装 npm 包。GitHub Actions 会从锁文件重新构建并发布 Player。
