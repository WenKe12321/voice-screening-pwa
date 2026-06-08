# 多层嵌套学习框架

## 定位

本项目的多层嵌套学习框架不是单个深度模型，而是一套可审计的研究建模流程。它把“语音如何进入筛查研究模型”拆成五层，确保端侧特征、任务结构、个体概率、目标域校准和持续验证各自有明确边界。

PHQ-9 仍然是应用内唯一风险等级来源。语音模型只输出研究概率，不能改变 PHQ-9 等级，也不能作为医学诊断。

## 五层结构

| 层级 | 名称 | 当前状态 | 输入 | 输出 |
|---|---|---|---|---|
| 1 | 语音片段特征层 | 已实现 | 每段录音 | 浏览器一致的声学特征 |
| 2 | 任务级表示层 | 已实现 | 不同任务的特征 | 保留任务来源的受试者特征矩阵 |
| 3 | 个体筛查模型层 | 基线阶段 | 受试者隔离训练集 | SDS 标签研究概率 |
| 4 | 中文大学生目标域适配层 | 需要合规目标域数据 | 中文大学生语音与 PHQ-9 标签 | 校准阈值与目标域验证报告 |
| 5 | 持续评估更新层 | 计划中 | 冻结模型、版本化数据和外部验证队列 | 模型卡、置信区间、审计记录 |

## 当前实现

当前仓库已经实现前三层：

1. 浏览器端与 Python 端使用同一组可移植声学特征。
2. 研究采集模式保留 `eatd-positive`、`eatd-neutral`、`eatd-negative` 三个任务的独立特征，不提前混合。
3. 训练流水线使用受试者隔离训练/验证划分，导出标准化逻辑回归候选模型。

第四层尚未完成，因为需要合规的中文大学生目标域语音数据，最好包含 PHQ-9 总分或题目级得分、任务文本、年龄/性别/年级等基础信息，以及清晰的数据使用协议。

## `.vmodel` 元数据

训练流水线导出的 `.vmodel` 可以携带 `modelCard.nestedLearning`：

```json
{
  "frameworkVersion": "nested-learning/1.0.0",
  "targetPopulation": "Chinese college students",
  "currentModelStage": "public-chinese-baseline",
  "calibrationStatus": "not-calibrated",
  "layers": [
    {
      "id": "segment-features",
      "name": "语音片段特征层",
      "status": "implemented",
      "input": "Raw WAV for each prompt",
      "output": "Browser-compatible acoustic feature vector per recording"
    }
  ],
  "caution": "EATD is a public Chinese SDS baseline. Do not describe it as calibrated for Chinese college students until licensed PHQ-9 target-domain validation is complete."
}
```

前端导入模型时会校验框架版本、目标人群、学习阶段、校准状态和五层顺序。旧模型如果没有这段元数据，仍可导入，但设置页会提示“未携带嵌套学习元数据”。

## 后续升级路线

1. 获得中文大学生目标域数据授权。
2. 冻结当前 EATD 基线模型，在目标域数据上先做外部验证。
3. 若指标稳定，再训练目标域校准层，记录校准集、验证集和阈值选择规则。
4. 只有目标域验证达到预设门槛，才允许导出 `target-domain-calibrated` 阶段的 `.vmodel`。
5. 每次模型更新都生成模型卡和不可上传的本地逐样本预测文件。
