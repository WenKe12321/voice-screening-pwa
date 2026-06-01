export interface RecordingTask {
  id: string
  eyebrow: string
  title: string
  prompt: string
  note: string
}

export const STANDARD_RECORDING_TASKS: RecordingTask[] = [
  {
    id: 'neutral-words',
    eyebrow: '标准朗读 · 01',
    title: '读出十个中性词',
    prompt: '中间、弹起、商品、村寨、最早、绿荫、和美、操纵、中点、山寨',
    note: '请保持自然语速，无需刻意调整情绪。',
  },
  {
    id: 'north-wind',
    eyebrow: '标准朗读 · 02',
    title: '朗读短文《北风与太阳》',
    prompt: '有一次，北风和太阳正在争论谁比较有本事。他们正好看到有个穿着大衣的人走过来，他们就说，谁可以让那个人脱掉那件大衣，就算谁比较有本事。于是北风开始拼命地吹。怎知，他吹得越厉害，那个人就越是用大衣包裹自己。最后，北风没办法，就放弃了。接着，太阳出来晒了一会儿，那个人感觉变得很热，立刻把大衣脱掉了。于是，北风只好认输了。',
    note: '按平时朗读文章的方式完成即可。',
  },
  {
    id: 'open-routine',
    eyebrow: '温和开放回答 · 03',
    title: '说说最近的日常节奏',
    prompt: '最近一周，你的学习、休息和睡眠节奏大致是怎样的？',
    note: '没有标准答案，可以只说你愿意分享的部分。',
  },
  {
    id: 'open-support',
    eyebrow: '温和开放回答 · 04',
    title: '说说让你感到支持的事情',
    prompt: '最近有没有一件让你感到轻松一点，或得到支持的小事？',
    note: '如果暂时不想回答，也可以说“跳过”。',
  },
]

export const EATD_RESEARCH_TASKS: RecordingTask[] = [
  {
    id: 'eatd-positive',
    eyebrow: '研究采集 · 积极回答',
    title: '说说一件让你感到愉快的事',
    prompt: '请回想近期一件让你感到愉快、轻松或温暖的小事，并自然地讲述它。',
    note: '该问题用于与 EATD-Corpus 研究任务对齐。只分享你愿意表达的内容。',
  },
  {
    id: 'eatd-neutral',
    eyebrow: '研究采集 · 中性回答',
    title: '说说最近的一段日常',
    prompt: '请自然地描述最近一天中一段普通的日常，例如上课、吃饭、散步或休息。',
    note: '保持自然语速即可，不需要刻意调整情绪。',
  },
  {
    id: 'eatd-negative',
    eyebrow: '研究采集 · 低落回答',
    title: '说说一件近期的困扰',
    prompt: '如果你愿意，请简单讲述近期一件让你感到困扰或不顺利的小事。',
    note: '可以随时跳过或退出。该回答只保存在当前设备中。',
  },
]

export const RECORDING_TASKS = STANDARD_RECORDING_TASKS
