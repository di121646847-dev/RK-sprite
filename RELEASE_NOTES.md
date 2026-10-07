# RK sprite v0.1.0

首个整理版。Windows x64 便携程序，无需联网或单独安装 Node.js。

- 从本地视频选帧，或导入 PNG 序列、网格图和带 JSON 的 Atlas。
- 按动作管理帧和装备图层，拖动排序、禁用帧、逐帧前后关系及角色对齐。
- 动画速度保存到动作，预览和 Godot 视觉播放使用同一倍率。
- 参考轴、可调像素网格、吸附和残影仅用于编辑，不进入导出图片。
- 导出独立的身体/装备 Atlas；可向选中的 Godot 工程同步视觉播放器和预览场景。

Godot 同步不会自动替换现有角色控制器、碰撞和攻击逻辑。预览层的武器和特效不导出。请保留 ZIP 解压后的整个程序目录。

## English

First organized Windows x64 portable release. Import and select video frames, edit layered sprite animations, export separate body/equipment atlases, and sync a visual playback scene to a selected Godot 4 project. Godot character controllers and gameplay logic are not wired automatically. Keep the extracted application folder together.
