# 真实语音研究模型训练说明

## 数据隔离

真实语音数据、权重和逐样本预测统一保存在：

```text
F:\Datasets\voice-screening
```

该目录位于 Git 仓库之外。不要将原始数据、模型权重、逐样本预测或包含个人信息的报告上传到 GitHub。

目录结构：

```text
raw/          原始数据
processed/    提取后的本地特征
artifacts/    本地模型权重
reports/      评估报告与逐样本预测
manifests/    来源、许可和申请清单
.venv/        隔离 Python 环境
```

## 中文大学生目标域数据

真实目标域训练需要带明确授权范围的中文大学生语音和量表数据。当前尚未取得可直接使用的 `PHQ-9` 目标域录音，因此不能声称现有权重适用于中文大学生。

项目已整理可申请来源和人工步骤：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py write-target-domain-checklist
```

清单会写入：

```text
F:\Datasets\voice-screening\manifests\target-domain-source-checklist.local.json
```

来源分级、联系入口和申请邮件模板见 [中文大学生目标域语音数据来源](target-domain-data-sources.md)。

## 初始化环境

```powershell
python -m venv F:\Datasets\voice-screening\.venv
F:\Datasets\voice-screening\.venv\Scripts\python.exe -m pip install -r training\requirements-core.txt
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py init-workspace
```

## EATD 中文开放回答基线

作者仓库：[ICASSP2022-Depression](https://github.com/speechandlanguageprocessing/ICASSP2022-Depression)

OneDrive 下载需要在浏览器中输入作者 README 提供的公开密码。解压后运行：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py validate-eatd --dataset "F:\Datasets\voice-screening\raw\eatd\EATD-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py extract-eatd --dataset "F:\Datasets\voice-screening\raw\eatd\EATD-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py train-baselines
```

流水线使用标准 SDS 分数 `>= 53` 作为研究阳性标签，保留作者提供的训练集和验证集划分，比较逻辑回归、SVM 和随机森林。验证集只用于最终评估。

可导入模型包只会在达到门槛时生成：

```text
F:\Datasets\voice-screening\artifacts\eatd-logistic.importable.vmodel
```

## 合成数据烟雾测试

合成语音只用于检查程序，不能用于报告模型准确率：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py smoke --output "F:\Datasets\voice-screening\raw\synthetic-eatd-v2"
```

## GRU/BiLSTM 离线对照

深度模型仅用于离线研究对照，不导出到手机：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe -m pip install -r training\requirements-deep.txt
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\deep_reference.py --smoke
```

## Androids 补充实验

完成 EATD 基线后再下载 [Androids Corpus](https://github.com/androidscorpus/data)。朗读任务和访谈任务必须分开评估，不与 EATD 混合计算准确率。

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py register-androids-archive --archive "F:\Datasets\voice-screening\raw\androids\Androids-Corpus.zip"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py validate-androids --dataset "F:\Datasets\voice-screening\raw\androids\Androids-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py extract-androids --dataset "F:\Datasets\voice-screening\raw\androids\Androids-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py train-androids
```

脚本保留压缩包中作者提供的 `fold-lists.csv` 五折划分，并生成：

```text
F:\Datasets\voice-screening\reports\androids-baseline-summary.json
F:\Datasets\voice-screening\reports\androids-validation-predictions.local.json
```

Androids 的标签是患者/健康对照条件，不是 SDS、PHQ-9 或临床诊断结论。报告不会生成手机端可导入模型。真实数据下载前可执行：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py smoke-androids --output "F:\Datasets\voice-screening\raw\synthetic-androids"
```

## MODMA 外部验证

MODMA 需要人工签署 EULA。获批后，先冻结 EATD 模型并进行外部验证，再决定是否训练 MODMA 专用模型。

申请步骤见 [MODMA 申请说明](modma-application.md)。
