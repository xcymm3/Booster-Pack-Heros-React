# Booster Pack Heroes H5

《卡包英雄》的 Taro、React 和 Canvas 2D 网页移植。当前范围是原版主战役的威望 0，从核心箱、第一次开包和升塔，直到第三章第二形态、群星之门和结局过场。地图、单位及动作帧、卡包、升级图标、塔楼、过场、部分粒子纹理和音效来自 Unity Windows 发布包。

## 本地运行

使用 Node.js 22，在项目目录运行：

~~~powershell
npm ci
npm run build:h5
npm run preview
~~~

[本地预览](http://127.0.0.1:4173/) 使用当前浏览器存档。[独立参考存档](http://127.0.0.1:4173/?slot=reference) 和普通入口分别保存进度。开发时运行 `npm run dev:h5`，Web 产物在 `dist`。

## Windows 单文件版

`npm run build:exe` 生成 `release/Booster-Pack-Heroes.exe`。`npm run build:exe:compact` 生成 `release/Booster-Pack-Heroes-Compact.exe`，在打包时将 FLAC 背景音频编码为 Opus。构建紧凑版需要支持 libopus 的 FFmpeg，可通过 PATH 或 `BPH_FFMPEG` 指定。两个 EXE 都内置运行时。

## 操作

- 把光标放到中央 CORE BOX 上，连续攻击后进入第一战。触屏可按住，键盘可聚焦战场并按住空格。
- 战斗中用光标攻击敌人和地面卡包。单位召出后自动战斗。首次解锁的卡牌会出现揭示画面。
- 结算后在整备界面购包、升级、看收藏。可拖动或缩放升级树。战场右上角和整备页均可进入主菜单。
- 击败首领后打开章节奖励包，结算并进入下一章。第三章结算后可从树上的群星之门进入结局过场。
- 购买、开包、升级、结算和章节切换写入本机存档。刷新后可以从战斗开始检查点、已生成的首领奖励或结算继续。

## 验证

~~~powershell
npm run typecheck
npm run verify:h5
npm run build:h5
~~~

`verify:h5` 以固定随机种子 13，从空白战役数据购买升级和卡包、开包部署、战斗、领奖并跨章。测试覆盖 76 名第一章敌人、119 名第二章敌人、第三章两阶段巫师，以及首领奖励和结算被序列化后能恢复。测试直接调用游戏规则，不经过鼠标、键盘和系统窗口。

| 原版录像 P1 时间 | 检查画面 |
| --- | --- |
| 0:00–0:42 | 核心箱、标题、空手首战、失败结算、第一次商店 |
| 2:51–3:35 | 主菜单、塔楼过场、基础卡包、侍从揭示 |
| 24:43–27:13 | 第一章首领、结算、整备树、第二章红棕色战场 |
| 51:31–55:41 | 第二章首领、魔法卡包、第三章紫色战场、圣物卡包 |
| 79:10–79:26 | 巫师第一形态倒地、镜头故障效果和第二形态 |
| 81:15 | 群星之门与星空树面板 |

录像抽帧与原版资产、布局数据用于核对上表场景。首次开包还使用相同的 Canvas 绘制函数输出五个固定状态，与 P1 3:12–3:24 对照。样本统一缩放到 426 × 240，统计中央战场的 RGB 平均绝对误差（0 至 255）。近景蓄势由 8.38 降到 3.58，爆发帧仍有 10.76 的误差。原版近景、爆发和继续提示也在 10 FPS 抽帧里分别核对。网页 HUD 位于 React DOM 中，离屏画布样本未覆盖整页。 [画布对照指标](<../Booster Pack Heroes - REA/qa/opening/metrics.json>)

卡包和卡箱的有效命中次数采用发布包的两击路径和各自的升级减免，依据 `BoosterPack.GetHitsToOpen` 与 `BoosterBox.GetHitsToOpen`。塔楼和侍从晋阶使用录像中的原版 SupporterPackSkin，按发布包中六个塔楼阶段的顺序切换。

当前完成了上述画布对照、命令行规则重放和 H5 构建。浏览器实机截图命令被执行策略拦截，整页逐帧对照尚未完成。Unity 灯光、部分特效曲线、单位行为细节、音频混音及原版云存档仍有差异。

[B 站录像 P1](https://www.bilibili.com/video/BV1eXWk6gEXE/?p=1) · [首章战斗解析](<../Booster Pack Heroes - REA/combat-first-wave.json>) · [二三章与资源索引](src/data/chapters-2-3.json) · [升级树数据](src/data/upgrades-1-3.json) · [卡包配置](<../Booster Pack Heroes - REA/booster-pack-config.json>)
