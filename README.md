# 心声自测

当前版本：`v0.2.9`，数据管理与可信隐私版。

“心声自测”是一款面向大学生群体的轻量级语音交互式心理健康辅助筛查应用。它可以安装到手机主屏幕，也可以直接在浏览器中使用。

手机访问地址：

```text
https://wenke12321.github.io/voice-screening-pwa/
```

应用会引导用户完成 PHQ-9 问卷和四段简短录音，在设备本地提取语音特征，并将问卷、录音和分析结果加密保存到当前浏览器中。

## 重要说明

- 本项目是研究展示原型，不是医疗器械。
- 应用不能诊断抑郁症，也不能替代医生、心理咨询师或紧急服务。
- PHQ-9 是唯一可解释的风险等级来源。
- 语音模块只展示端侧特征和未经临床验证的演示指数，不会改变 PHQ-9 风险等级。
- PHQ-9 第 9 题只要选择非零选项，应用就会立即展示求助卡片。
- 求助卡片提供全国统一心理援助热线 `12356`。存在即时危险时，应联系 `110`、`120` 或身边可信任的人。

## 主要功能

1. 阅读知情同意说明。
2. 创建或解锁本地保险箱。
3. 完成 PHQ-9 问卷。
4. 朗读十个中性词。
5. 朗读短文《北风与太阳》。
6. 完成两段温和开放回答。
7. 在设备本地提取语音节奏、能量、基频和频谱摘要。
8. 查看 PHQ-9 风险等级与语音研究特征概览。
9. 查看、删除本地记录，或导出 `.vscreen` 加密研究包。

## 隐私设计

- 应用不需要注册账号。
- 应用不会自动上传录音、问卷或分析结果。
- 所有敏感数据默认保存在当前浏览器的 IndexedDB 中。
- 数据写入浏览器前会使用 `AES-GCM-256` 加密。
- 访问密钥通过 `PBKDF2-SHA-256` 从用户设置的口令派生。
- 口令和密钥不会持久化保存。关闭应用后，需要重新输入口令。
- 口令遗失后无法恢复数据，只能清空本地保险箱。

更完整的说明见 [隐私说明](docs/privacy.md)。

## 本机运行

需要提前安装 Node.js 和 npm。

```powershell
cd C:\Users\1\Documents\Codex\2026-05-31\notebooklm-mcp-https-github-com-pleaseprompto\outputs\voice-screening-pwa
npm install
npm run dev
```

浏览器打开：

```text
http://localhost:5173
```

浏览器只有在 HTTPS 或 `localhost` 环境下才能访问麦克风。

## 构建生产版本

```powershell
npm run build
```

构建后的静态文件位于：

```text
dist/
```

可以将 `dist/` 部署到任意支持 HTTPS 的静态托管服务。

## 解密导出的研究包

`.vscreen` 是本项目自定义的加密研究包。它不会以明文保存问卷、录音或语音特征。

在项目目录中运行：

```powershell
npm run decrypt:vscreen -- "C:\path\to\research-package.vscreen"
```

终端会提示输入创建本地保险箱时设置的访问口令。输入过程会显示为 `*`。解密成功后，同一目录会生成：

```text
research-package.decrypted.json
```

也可以显式指定输出位置：

```powershell
npm run decrypt:vscreen -- "C:\path\to\research-package.vscreen" "C:\path\to\output.json"
```

注意：

- 解密后的 JSON 包含敏感数据，请妥善保管。
- 新版 `.vscreen` 使用结构版本 `2`，包含独立解密所需的非敏感盐值和迭代次数，但不包含访问口令或派生密钥。
- 旧版结构版本 `1` 没有包含盐值，无法脱离原浏览器独立解密。请回到保存原始记录的浏览器，从“查看本地记录”页面重新导出。

## 安装到手机

应用采用渐进式网页应用（PWA）形式发布。首次在线完整打开后，静态资源可以离线使用。

### Android

1. 使用 Chrome 或 Edge 打开 `https://wenke12321.github.io/voice-screening-pwa/`。
2. 打开浏览器菜单。
3. 选择“安装应用”或“添加到主屏幕”。

### iPhone

1. 使用 Safari 打开 `https://wenke12321.github.io/voice-screening-pwa/`。
2. 点击分享按钮。
3. 选择“添加到主屏幕”。

## 测试与验收

运行单元测试、代码检查和生产构建：

```powershell
npm test
npm run lint
npm run build
```

运行端到端浏览器验收时，先启动预览服务：

```powershell
npm run preview -- --host 127.0.0.1
```

再打开另一个终端执行：

```powershell
npm run test:e2e
```

端到端测试会调用本机 Chrome 的测试麦克风，并自动检查：

- 390×844 和 360×800 手机视口是否存在横向溢出。
- 应用清单和后台离线缓存服务是否正常注册。
- PHQ-9、四段录音、本地分析和结果页是否可以完整走通。
- `.vscreen` 导出文件是否保持加密状态。
- 刷新页面后是否需要重新解锁。
- 删除记录后 IndexedDB 中是否不再保留会话。
- 断网后是否仍能重新打开应用。
- 应用运行期间是否存在意外的外部网络请求。

## 语音模型说明

未导入模型时，应用使用 `DemoVoiceModelAdapter` 演示适配器。它输出的是未经临床验证的确定性演示指数，仅用于展示端侧流程。

项目已提供真实数据训练流水线。获得合规数据并通过验证门槛后，可以在“隐私与设置”页面导入 `.vmodel` 文件，并使用独立的“研究采集模式”。普通自测仍保持原流程，PHQ-9 仍是唯一风险等级来源。

训练数据、模型权重和逐样本预测只保存在 `F:\Datasets\voice-screening`，不进入 Git 仓库。具体步骤见 [模型训练说明](docs/training.md)、[模型接入说明](docs/model-integration.md) 和 [多层嵌套学习框架](docs/nested-learning-framework.md)。

已完成的 EATD 真实数据实验没有达到应用启用门槛，因此当前版本不会附带真实模型权重。去标识化结果见 [EATD 中文开放回答基线汇总](docs/reports/eatd-baseline-summary.md)。

已完成 Androids Corpus 朗读与访谈任务的独立五折实验。该实验使用患者/健康对照条件标签，不与 EATD、SDS 或 PHQ-9 混算，也不会生成手机端模型。去标识化结果见 [Androids 独立五折基线汇总](docs/reports/androids-baseline-summary.md)。

当前尚未取得可直接用于训练的中文大学生 `PHQ-9` 目标域录音。项目已整理可申请来源、人工步骤和许可边界，见 [中文大学生目标域语音数据来源](docs/target-domain-data-sources.md)。

## 研究资料说明

本项目不会分发 MODMA、AVEC 等受限数据集，也不会在仓库中附带未经授权的数据或模型。文献依据、首版限制和后续训练路线见 [研究备注](docs/research-notes.md)。

## 技术栈

- React 19
- TypeScript
- Vite 8
- `vite-plugin-pwa`
- IndexedDB
- Web Crypto API
- MediaRecorder API
- Web Audio API
- Vitest
- Playwright

## 项目文档

- [隐私说明](docs/privacy.md)
- [模型接入说明](docs/model-integration.md)
- [用户友好筛查与开源项目调研](docs/user-friendly-risk-and-open-source-review.md)
- [模型训练说明](docs/training.md)
- [多层嵌套学习框架](docs/nested-learning-framework.md)
- [中文大学生目标域语音数据来源](docs/target-domain-data-sources.md)
- [MODMA 申请说明](docs/modma-application.md)
- [EATD 基线汇总](docs/reports/eatd-baseline-summary.md)
- [Androids 基线汇总](docs/reports/androids-baseline-summary.md)
- [研究备注](docs/research-notes.md)
