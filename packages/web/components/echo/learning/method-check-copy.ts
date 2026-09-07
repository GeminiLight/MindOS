export const methodCheckCopy = {
  en: {
    title: 'Check the method’s boundaries',
    lead: 'Try two different situations: one where this method should help, and one where it should not be applied mechanically.',
    newCheck: 'Create another check',
    back: 'Back to the saved check',
    choose: 'Saved check',
    use: 'Where it should apply',
    exception: 'Where it should not apply',
    task: 'Situation and task',
    expected: 'What would count as appropriate behavior?',
    freeze: 'Save these cases and criteria',
    frozen:
      'Cases and criteria stay as saved. Create another check to change them. Criteria are not included in the prepared Agent task.',
    prepare: 'Prepare this case',
    prepared:
      'The task is ready in a new conversation. Review it and send when ready; preparation does not mean it has run.',
    capture: 'Read and save matching runs',
    refresh: 'Reload check',
    loading: 'Loading check…',
    saving: 'Saving…',
    noRuns:
      'No matching recent run yet. Send the prepared task with its attached method, then read the runs here. Editing the task or method can prevent a match.',
    run: 'Choose an actual run',
    select: 'Choose a run',
    outcome: 'Your assessment against the saved criterion',
    outcomes: {
      met: 'Meets the criterion',
      missed: 'Misses the criterion',
      uncertain: 'Still uncertain',
    },
    quote: 'Quote the relevant output',
    reason: 'Explain your assessment',
    save: 'Save my assessment',
    revise: 'Save a revised assessment',
    reviseHint: 'A revision keeps your earlier assessment and adds a new one.',
    saved: 'Saved assessments',
    reported: 'Your assessment, supported by the quoted output',
    output: 'Run output summary',
    failed:
      'This run did not finish successfully. Keep its failure record and retry when ready; it cannot receive a successful assessment.',
    savedRun: 'Saved run snapshot',
    recent:
      'Matching uses the exact task and approved method fingerprint. Recent live records are searched; saved snapshots remain available.',
    export: 'Export this check',
    limit:
      'This check has reached its preparation limit. Existing evidence remains available.',
    empty: 'Save a pair of cases to begin.',
    partial:
      'Some saved checks could not be read. Other records remain available.',
    unavailable:
      'The method is paused, unavailable or archived. Existing checks can still be reviewed.',
    statuses: {
      queued: 'Queued',
      running: 'Running',
      streaming: 'Responding',
      completed: 'Completed',
      failed: 'Failed',
      canceled: 'Canceled',
      timed_out: 'Timed out',
    },
    errors: {
      invalid:
        'Check the two distinct tasks and required fields. When assessing a run, quote text from the displayed output.',
      conflict:
        'This record changed, a run is active, or the method is unavailable. Reload and check its current state.',
      storage:
        'Could not load or save this check. Your input is kept; please retry.',
      'not-found': 'This method or check is unavailable.',
    },
  },
  zh: {
    title: '检验方法的适用边界',
    lead: '用两种不同情境检验：一种应当受益于这条方法，另一种不应机械套用。',
    newCheck: '另建一组检验',
    back: '回到已保存的检验',
    choose: '已保存的检验',
    use: '应当适用的情境',
    exception: '不应套用的情境',
    task: '情境与任务',
    expected: '怎样的表现才符合预期？',
    freeze: '保存这组案例与判断标准',
    frozen:
      '案例与标准按保存时保留；调整材料请另建一组。准备 Agent 任务时不会附带判断标准。',
    prepare: '准备这个案例',
    prepared: '任务已在新会话中准备好，请核对后再发送。准备好不代表已运行。',
    capture: '读取并留存匹配的运行',
    refresh: '重新读取',
    loading: '正在读取检验…',
    saving: '正在保存…',
    noRuns:
      '暂未找到最近的匹配运行。请发送准备好的任务与所附方法，再回到这里读取。修改任务或方法后可能无法匹配。',
    run: '选择实际运行',
    select: '选择一条运行',
    outcome: '对照事先标准，你的判断是',
    outcomes: { met: '符合标准', missed: '未符合标准', uncertain: '仍不确定' },
    quote: '引用相关输出',
    reason: '说明判断依据',
    save: '保存我的核对',
    revise: '保存修订后的核对',
    reviseHint: '修订会追加新记录，保留以前的判断。',
    saved: '已保存的核对',
    reported: '你的判断，依据所引用的实际输出',
    output: '运行输出摘要',
    failed:
      '这次运行没有成功完成。可以保留失败记录，准备好后再试；不能据此记为检验通过。',
    savedRun: '已留存的运行快照',
    recent:
      '按实际任务和批准方法的内容指纹匹配。列表查找最近运行；留存的快照可继续回看。',
    export: '导出这组检验',
    limit: '已达到这组检验的任务准备上限。已有证据仍可回看。',
    empty: '先保存一组案例，再开始检验。',
    partial: '部分检验暂时无法读取，其他记录仍可查看。',
    unavailable: '方法已暂停、不可用或已归档。已有检验仍可回看。',
    statuses: {
      queued: '等待中',
      running: '运行中',
      streaming: '正在回答',
      completed: '已完成',
      failed: '失败',
      canceled: '已取消',
      timed_out: '已超时',
    },
    errors: {
      invalid:
        '请填写两个不同任务及必填项；核对运行时，请引用下方实际输出中的原文。',
      conflict:
        '记录已更新、仍有运行进行中，或方法暂不可用。请重新读取并检查当前状态。',
      storage: '暂时无法读取或保存。输入仍保留，请重试。',
      'not-found': '方法或检验记录暂时不可用。',
    },
  },
};
export type MethodCheckCopy = typeof methodCheckCopy.en;
