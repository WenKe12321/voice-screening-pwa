# 语音模型接入说明

## 首版模型边界

首版使用 `DemoVoiceModelAdapter`。它只用于展示端侧特征提取和模型替换流程，未经临床验证，不参与 PHQ-9 风险等级判断。

## 特征结构

`VoiceFeatures` 位于 `src/domain/types.ts`。聚合字段包括：

- 总录音时长。
- 有效语音比例、停顿比例。
- RMS 能量均值和波动。
- 过零率。
- 基频中位数和范围。
- 频谱质心。
- 8 维 MFCC 摘要。
- 固定朗读任务的语速代理指标。
- 每个录音任务的独立特征。

## 模型接口

```ts
interface VoiceModelAdapter {
  version: string
  predict(features: VoiceFeatures): Promise<VoiceResearchResult>
}
```

后续模型只需要实现该接口，再替换 `src/lib/voiceModel.ts` 中创建适配器的位置。

## 推荐后续路线

1. 完成伦理审查、知情同意和数据治理方案。
2. 签署 MODMA 等受限数据集许可协议，或按规范采集校园预测试数据。
3. 以固定中性词和《北风与太阳》任务为起点建立可复现基线。
4. 比较 AdaBoost、随机森林、LDA 和 SVM 等传统模型，再探索轻量神经网络。
5. 使用独立测试集报告 F1、召回率、特异度、ROC-AUC 和校准表现。
6. 对模型进行量化和端侧性能评估。
7. 将验证后的模型封装为新的 `VoiceModelAdapter`。

任何新模型都必须保留“辅助筛查，不是诊断”的产品边界，并接受独立验证。
