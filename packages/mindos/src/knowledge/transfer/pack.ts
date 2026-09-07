// Server-owned illustrative practice material. This is not a validated ability test.
export function evidencePracticePack(locale: 'en' | 'zh') {
  const zh = locale === 'zh';
  return {
    id: 'evidence-calibration', version: 1, locale, delayDays: 7,
    title: zh ? '证据与结论：一次独立练习' : 'Evidence and conclusions: an independent practice',
    guidance: zh
      ? '先找出比较来自哪里：随机分配、主动选择，还是只观察已有差异？再提出一种可能的替代解释，看看研究是否排除了它。最后让结论的强度与证据相称：指出能说什么、还不能说什么，以及哪一种新证据能区分这些解释。设计名称本身不是充分理由。'
      : 'Identify the comparison: random assignment, self-selection, or observed differences? Name a plausible alternative explanation and check whether the study rules it out. Match the strength of the conclusion to the evidence. Say what it supports, what remains uncertain, and what new evidence would distinguish explanations. A design label alone is not sufficient.',
    tasks: [
      {
        id: 'coffee-observation',
        prompt: zh ? '练习材料（虚构）：研究者跟踪了 800 人，发现每天喝咖啡的人在一年后报告的疲劳更少。参与者自行决定是否喝咖啡；两组的睡眠、工作时长和运动情况未被控制。摘要写道：“每天喝咖啡能减少疲劳。”你会如何判断并改写这个结论？解释依据，以及你还想知道什么。'
          : 'Fictional practice material: Researchers followed 800 people. Daily coffee drinkers reported less fatigue after one year. Participants chose whether to drink coffee; sleep, working hours and exercise were not controlled. The abstract says: “Daily coffee reduces fatigue.” How would you assess and rewrite this conclusion? Explain your reasoning and what else you would want to know.',
        reference: zh ? '观察到关联，但自选分组和未控制差异允许替代解释。可以写“在这组参与者中，喝咖啡与较少疲劳相关”；需要进一步识别设计或相关变量的证据，不能仅凭现有比较作因果判断。' : 'The observation supports an association. Self-selection and uncontrolled differences allow alternative explanations. A calibrated statement is that coffee drinking was associated with less fatigue in these participants. Stronger identification or evidence about relevant differences is needed for a causal claim.',
      },
      {
        id: 'school-before-after',
        prompt: zh ? '练习材料（虚构）：一所学校自愿试用新的阅读工具。三个月后，学生的平均阅读成绩比开学时提高了 12 分。没有其他学校作为对照；这期间学生也接受了正常阅读课。学校宣称：“这个工具带来了 12 分的提升。”请判断这个说法，提出更合适的结论和下一步检验。'
          : 'Fictional practice material: A school volunteered to try a new reading tool. After three months, average reading scores were 12 points higher than at the start of term. There was no comparison school, and normal reading lessons continued. The school claims: “This tool produced a 12-point improvement.” Assess the claim, propose a better conclusion and a next test.',
        reference: zh ? '前后差异不能单独区分工具作用、正常教学、成熟或重复测验。应报告试用期间的变化而非把全部变化归给工具。可提出有可比对照、平衡教学与测量条件的检验；并说明选择偏差等剩余限制。' : 'A before–after difference cannot separate the tool from normal teaching, maturation or repeated testing. Report the change during the trial without attributing it all to the tool. Propose a credible comparison with comparable teaching and measurement, and acknowledge remaining selection issues.',
      },
      {
        id: 'workshop-randomized-attrition',
        prompt: zh ? '练习材料（虚构）：120 名员工被随机分配到写作工作坊或常规培训。最后只比较了完成随访者：工作坊组 30 人、对照组 55 人。工作坊完成者得分更高；未报告退出原因和缺失者表现。报告称：“随机试验证明工作坊有效。”你如何评价这条证据？哪些信息或分析可能改变判断？'
          : 'Fictional practice material: 120 employees were randomly assigned to a writing workshop or usual training. The report compares only those who completed follow-up: 30 in the workshop group and 55 in the comparison group. Workshop completers scored higher; reasons for dropout and outcomes of missing participants were not reported. The report says: “The randomized trial proves the workshop works.” Evaluate this evidence. What information or analysis could change your judgment?',
        reference: zh ? '随机分配改善起点可比性，但仅比较完成者可能因不同程度的脱落而破坏它。不能只凭“随机试验”标签下结论。应检查初始分组人数、退出机制、按原分组分析及缺失数据敏感性；现有结果仍需保留不确定性。' : 'Random assignment improves comparability initially, but comparing completers after differential dropout can undermine it. The randomized label is insufficient. Examine original group sizes, dropout mechanisms, analysis by original assignment and sensitivity to missing outcomes. Retain uncertainty in the current conclusion.',
      },
    ],
    criteria: zh ? ['识别比较方式与证据边界', '解释具体的替代解释或适用限制', '提出相称的结论与能区分解释的新证据'] : ['Identify the comparison and evidence boundary', 'Explain a concrete alternative or limitation', 'Calibrate the conclusion and propose distinguishing evidence'],
  };
}
export type TransferPack = ReturnType<typeof evidencePracticePack>;
