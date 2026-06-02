# 真实语音研究模型训练

训练数据、模型权重和逐样本预测统一保存在 `F:\Datasets\voice-screening`，不进入 Git 仓库。

## 初始化

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py init-workspace
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py write-modma-checklist
```

## EATD-Corpus

作者仓库：[ICASSP2022-Depression](https://github.com/speechandlanguageprocessing/ICASSP2022-Depression)

OneDrive 下载需要在浏览器中输入作者 README 提供的密码。解压后执行：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py validate-eatd --dataset "F:\Datasets\voice-screening\raw\eatd\EATD-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py extract-eatd --dataset "F:\Datasets\voice-screening\raw\eatd\EATD-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py train-baselines
```

只有验证集 `ROC-AUC >= 0.70` 且召回率 `>= 0.70` 时，才会生成 `eatd-logistic.importable.vmodel`。

## 合成数据烟雾测试

合成数据只用于检查流水线，不代表真实模型效果：

```powershell
python -m unittest training.pipeline_validation_test -v
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py smoke --output "F:\Datasets\voice-screening\raw\synthetic-eatd-v2"
```

## 深度模型对照

GRU/BiLSTM 仅用于离线研究对照，不导出到手机应用：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe -m pip install -r training\requirements-deep.txt
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\deep_reference.py --smoke
```

烟雾测试使用独立的 `deep-reference-smoke.local.pt` 和 `deep-reference-smoke.local.json`，不会覆盖真实 EATD 深度对照产物。运行真实对照：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\deep_reference.py
```

## Androids 与 MODMA

- Androids 下载后使用压缩包中的作者 `fold-lists.csv` 做五折实验，朗读与访谈必须分开评估。
- MODMA 需要人工填写、签署和上传 EULA。使用 `write-modma-checklist` 生成本地申请清单。
- 原始数据、派生权重和逐样本预测不得上传到 GitHub。

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py register-androids-archive --archive "F:\Datasets\voice-screening\raw\androids\Androids-Corpus.zip"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py validate-androids --dataset "F:\Datasets\voice-screening\raw\androids\Androids-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py extract-androids --dataset "F:\Datasets\voice-screening\raw\androids\Androids-Corpus"
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py train-androids
```

下载真实数据前，可用合成语音验证 Androids 独立评估路径：

```powershell
F:\Datasets\voice-screening\.venv\Scripts\python.exe training\voice_screening_pipeline.py smoke-androids --output "F:\Datasets\voice-screening\raw\synthetic-androids"
```
