# 语音研究模型接入说明

## 产品边界

- PHQ-9 始终是应用内唯一可解释的风险等级来源。
- 语音模型只能展示研究概率，不能改变 PHQ-9 结果。
- EATD 模型使用 SDS 自评标签，不等同于 PHQ-9，也不构成临床诊断。
- 未导入模型或模型不兼容时，应用回退到未验证演示指数。

## 两种采集模式

普通自测保留中性词、《北风与太阳》和两个温和开放回答。

研究采集模式使用与 EATD-Corpus 对齐的三个任务：

1. `eatd-positive`：讲述一件愉快、轻松或温暖的小事。
2. `eatd-neutral`：描述一段普通日常。
3. `eatd-negative`：讲述一件近期困扰。

EATD 模型仅对研究采集模式输出研究概率，避免任务域偏移。

## `.vmodel` 格式

训练流水线只有在受试者隔离验证集满足 `ROC-AUC >= 0.70` 且召回率 `>= 0.70` 时，才生成可导入模型包。

```ts
interface PortableVoiceModel {
  format: 'voice-screening-portable-model'
  schemaVersion: 1
  algorithm: 'standardized-logistic-regression'
  extractorVersion: string
  taskIds: ['eatd-positive', 'eatd-neutral', 'eatd-negative']
  featureOrder: string[]
  scaler: { mean: number[]; scale: number[] }
  model: { coefficients: number[]; intercept: number; threshold: number }
  validation: { rocAuc: number; recall: number; specificity: number; f1: number }
  modelCard: {
    source: 'EATD-Corpus'
    intendedUse: 'academic-research-only'
    limitations: string[]
  }
}
```

设置页会校验结构版本、特征提取器版本、任务列表、特征顺序、权重维度和验证门槛。通过校验后，模型保存在当前浏览器 IndexedDB 中。

## 特征结构

每个研究任务独立提取：

- 时长、有效语音比例和停顿比例。
- RMS 能量均值与波动。
- 过零率。
- 基频中位数与范围。
- 频谱质心。
- 8 维 MFCC 摘要。
- 语速代理指标。

端侧模型使用三个任务的独立特征，不将任务提前混合。
