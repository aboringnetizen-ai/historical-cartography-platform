# 定步进视频后端

renderMapVideo 从本地导播页面捕获由固定视频任务驱动的画面，逐帧校验渲染状态，再交给 FFmpeg 编码。输出一个独立目录，包含成片和逐帧哈希清单，可按任务生成 SRT 和一级史料附录。业务调用传入 VideoExportJobSpec、本地页面地址、FFmpeg 路径、分段修订清单与输出目录。页面与它的画面资源使用同一个本地源。

## 导播页面握手

| 页面函数 | 后端核对 |
| --- | --- |
| window.__CARTO_LOAD_RENDER_JOB__(spec) | 先载入运镜、HUD 和时间安排，返回 accepted 与一致的 project_id。 |
| window.__STEP_FRAME__(timeMs) | 每次等待实际地图、瓦片、字体和着色器就绪，返回帧号、时间、修订、四项就绪信号和 G5 结果。第一帧编号为 1。 |

后端核对期望帧号、时间和修订，拒绝任何 G5 问题、未就绪信号及读失败。握手或帧超时按失败处理。只有全部帧成功、编码器正常退出才生成最终清单。失败时清理该次导出的不完整文件。

1:1、16:9、9:16 和 21:9 以 1080、1440 或 2160 为短边，宽高取偶数。H.264 和 HEVC 使用 MP4，VP9 Alpha 使用 WebM，ProRes 4444 使用 MOV。旁白使用授权的本地音频文件，附录只输出传入的 T1 书目信息。交互式网页播放器包、Alpha 分层成组发布和高分辨率大规模测试待推进。

## 执行后端烟测

配置 CARTOGRAPHY_TEST_BROWSER、CARTOGRAPHY_TEST_FFMPEG 和 CARTOGRAPHY_TEST_FFPROBE 为对应的本地可执行文件路径，然后从仓库根目录运行：

~~~powershell
npm run test:render --workspace @historical-cartography/video-renderer
~~~

工程画布通过真实无头 Chromium 和 FFmpeg 验证。测试同一输入 3 秒 30 fps 的横屏、竖屏逐帧哈希复现，并验证失败帧及错修订无法留下成品。真实工作台页面需要由前端提供上述加载及帧步进契约，再进行真实地图和 HUD 联验。
