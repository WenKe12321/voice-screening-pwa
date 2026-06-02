# 研究依据与首版取舍

## 已阅读资料

- 《面向大学生群体的轻量级语音交互式抑郁筛查系统设计与实现》项目申请书 2.0
- 《课题2-申请书内容框架及推荐阅读文献》
- 陈梅妹等：《基于多种机器学习算法和语音情绪特征的阈下抑郁辨识模型构建》
- Valstar 等：AVEC 2016 Depression, Mood, and Emotion Recognition Workshop and Challenge
- 刘振焘等：《基于语音的抑郁检测研究综述》
- Menne 等：The voice of depression: speech features as biomarkers for major depressive disorder
- Behrouz 等：Nested Learning: The Illusion of Deep Learning Architecture
- MODMA Dataset EULA

## 首版采用的依据

陈梅妹等论文使用中性词和《北风与太阳》短文采集大学生语音，并从每段语音提取能量、MFCC、过零率、声音概率、基频和差分特征。其结果支持将 AdaBoost 和随机森林作为后续基线候选。

AVEC 2016 使用 PHQ 分数定义抑郁严重程度，并强调在统一条件下报告 F1、准确率、精确率和召回率。首版因此保留 PHQ-9 作为唯一可解释风险等级来源。

综述指出语音抑郁检测面临小样本、标注不统一和隐私风险。首版优先实现本地录音、本地加密和可替换模型接口，不宣称准确率。

Menne 等论文显示基频、响度、节奏和语音内容等变量具有研究价值。首版只实现无需云端服务的声学摘要，不做云端语音识别或文本情感分析。

## 暂不采用的内容

`NL.pdf` 讨论 Nested Learning 作为一般学习范式，主要围绕优化器、记忆系统和持续学习展开。它并不是可直接部署的移动端语音筛查模型，因此保留为后续探索方向，不进入首版依赖。

## 数据合规

MODMA EULA 要求：

- 仅用于学术研究，不得用于商业用途。
- 使用前必须签署协议并获得管理员授权。
- 不得分发数据集或其中的录音。
- 论文和展示必须遵守参与者许可范围，并标注数据来源。

本工程不包含 MODMA、AVEC 或其他受限语音数据，也不包含由这些数据训练的模型。

## 分阶段训练路线

1. 使用 EATD-Corpus 建立中文学生志愿者开放回答基线。
2. 申请中文大学生目标域语音，优先争取带 `PHQ-9`、朗读和自发言语的数据。
3. 使用 Androids Corpus 单独评估《北风与太阳》朗读任务。
4. 完成 MODMA EULA 并取得授权后，冻结模型进行中文临床外部验证。
5. 独立报告 F1、召回率、特异度、ROC-AUC、PR-AUC、Brier 分数和置信区间。
6. 只有受试者隔离验证集达到门槛时，才导出可导入 `.vmodel`。

不同来源的数据不能直接混合报告准确率。EATD 的 SDS 自评标签、Androids 的患者/对照标签和 MODMA 的临床信息需要分别解释。

中文大学生目标域语音的筛选结果、申请入口和许可边界见 [目标域数据来源](target-domain-data-sources.md)。
