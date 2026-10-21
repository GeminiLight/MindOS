const pairs = {
  title: ["视图", "Views"],
  subtitle: [
    "把资料变成顺手的界面，下次打开接着做。",
    "Turn your records into a useful interface. Pick up where you left off.",
  ],
  workbench: ["工作台", "Studio"],
  peopleTemplate: ["人脉模板", "People template"],
  defaultName: ["我的人脉", "My people"],
  template: ["使用模板", "Use a template"],
  usePeople: ["使用人脉模板", "Use the people template"],
  continue: ["继续", "Continue"],
  continueLabel: ["继续处理", "Continue working"],
  lastPerson: ["上次查看", "Last viewed"],
  allViews: ["已保存的视图", "Saved views"],
  searchViews: ["查找视图或资料", "Find a view or folder"],
  view: ["视图", "View"],
  data: ["关联资料", "Source folder"],
  recent: ["最近处理", "Last viewed"],
  open: ["打开", "Open"],
  manage: ["管理视图", "Manage view"],
  emptyTitle: ["创建自己的第一个视图", "Create your first view"],
  emptyBody: [
    "从人脉模板开始，关联已有资料或新建一个文件夹。",
    "Start with the people template. Use existing records or create a folder.",
  ],
  loading: ["正在读取视图…", "Loading views…"],
  retry: ["重试", "Retry"],
  errorTitle: ["暂时无法读取资料", "Could not read the records"],
  noResults: ["没有匹配的视图", "No matching views"],
  clearSearch: ["清除搜索", "Clear search"],
  folderMissing: ["资料文件夹已移动", "Source folder moved"],
  repair: ["重新关联", "Associate again"],
  personMissing: [
    "这份人物资料已移动或移除",
    "This person file was moved or removed",
  ],
  file: ["文件", "Files"],
  peopleView: ["人脉视图", "People view"],
  contacts: ["联系人", "People"],
  searchPeople: ["查找人物", "Find a person"],
  newPerson: ["新建人物", "New person"],
  editPerson: ["修改资料", "Edit details"],
  savePerson: ["保存人物", "Save person"],
  name: ["姓名", "Name"],
  background: ["背景", "Background"],
  focus: ["关注方向", "Focus"],
  backgroundHint: [
    "职业、认识场景，以及下次交流值得记得的背景。",
    "Their background, how you met and what matters for the next conversation.",
  ],
  followup: ["下次接着做", "Next time"],
  editFollowup: ["调整跟进", "Edit follow-up"],
  planFollowup: ["安排跟进", "Plan a follow-up"],
  next: ["下一步", "Next step"],
  date: ["计划日期", "Planned date"],
  completed: ["已完成", "Completed"],
  complete: ["标记完成", "Mark completed"],
  reopen: ["重新打开", "Reopen"],
  noPlan: ["暂未安排下一步", "No next step planned"],
  saveFollowup: ["保存跟进", "Save follow-up"],
  interactions: ["互动记录", "Interactions"],
  addInteraction: ["记录互动", "Log interaction"],
  interactionText: ["聊了什么", "What did you discuss?"],
  interactionDate: ["互动日期", "Interaction date"],
  source: ["关联来源", "Sources"],
  sourceOptional: ["关联来源（可选）", "Source (optional)"],
  sourceHint: [
    "链接、会话名称或原记录的位置",
    "A link, conversation title or original record",
  ],
  saveInteraction: ["保存互动", "Save interaction"],
  noInteractions: [
    "还没有互动记录。第一次交流后，可以从这里记下来。",
    "No interactions yet. Add a note after your first conversation.",
  ],
  newPersonTitle: ["从第一位联系人开始", "Start with your first person"],
  newPersonBody: [
    "先添加人物，之后再记录交流和跟进。",
    "Add a person, then log conversations and follow-ups.",
  ],
  noPeople: ["没有匹配的人物", "No matching people"],
  backPeople: ["返回联系人", "Back to people"],
  backViews: ["视图", "Views"],
  rawFile: ["查看原文件", "Original file"],
  openEditor: ["打开文件编辑器", "Open file editor"],
  fileLoading: ["正在读取原文件…", "Loading original file…"],
  fileEmpty: ["这里还没有资料文件。", "No source files yet."],
  exportCsv: ["导出关系总览", "Export people CSV"],
  csvHint: [
    "从当前人物资料导出；不会覆盖已有 CSV。",
    "Exports current records without replacing an existing CSV.",
  ],
  prepare: ["会前准备", "Meeting preparation"],
  prepareHint: [
    "先核对资料，再带给 Agent。",
    "Check the records, then take them to an Agent.",
  ],
  prepareTarget: ["准备给谁", "Prepare for"],
  materials: ["本次带哪些材料", "Include these records"],
  preview: ["预览准备材料", "Preview materials"],
  copy: ["复制材料", "Copy materials"],
  copying: ["正在复制…", "Copying…"],
  copied: [
    "已复制，外部接收尚未确认。",
    "Copied. External receipt is not confirmed.",
  ],
  copyFailed: [
    "复制失败，请在预览中选取内容后手动复制。",
    "Could not copy. Select the preview and copy manually.",
  ],
  openDraft: ["带到 MindOS 对话", "Continue in MindOS chat"],
  openDraftHint: [
    "只填写当前预览文字，不自动发送。",
    "Only fills the selected text. Nothing is sent automatically.",
  ],
  download: ["导出 Markdown", "Export Markdown"],
  privateHint: [
    "私人反思和未知段落不会自动进入材料。",
    "Private reflections and unknown sections are excluded.",
  ],
  close: ["关闭", "Close"],
  cancel: ["取消", "Cancel"],
  save: ["保存", "Save"],
  saving: ["正在保存…", "Saving…"],
  saved: ["已保存到原文件", "Saved to the original file"],
  draftRestored: ["已恢复未保存的草稿。", "Restored your unsaved draft."],
  draftUnavailable: [
    "草稿仅在当前窗口保留，关闭或刷新前请保存。",
    "Draft is kept in this window only. Save before closing or refreshing.",
  ],
  draftHint: [
    "未保存的输入按人物暂存，切换后仍可继续。",
    "Unsaved input is kept for this person so you can return to it.",
  ],
  discardDraft: ["丢弃草稿", "Discard draft"],
  conflictTitle: ["原资料已在别处更新", "The original file changed elsewhere"],
  conflictBody: [
    "你的草稿仍在。先核对当前版本，再决定怎样保存。",
    "Your draft is still here. Check the current version before continuing.",
  ],
  readLatest: ["查看最新版本", "Read current version"],
  keepDraft: ["核对后保留我的修改", "Keep my edits after review"],
  currentVersion: ["当前保存版本", "Current saved version"],
  myDraft: ["我的修改", "My changes"],
  manageTitle: ["管理视图", "Manage view"],
  viewName: ["视图名称", "View name"],
  rename: ["保存名称", "Save name"],
  remove: ["移除视图", "Remove view"],
  removeTitle: ["移除这个视图？", "Remove this view?"],
  removeBody: [
    "只移除视图入口，原文件夹和人物资料都会保留。",
    "Only the view is removed. The original folder and people files remain.",
  ],
  rebind: ["修复资料关联", "Repair folder association"],
  savedView: ["视图已保存", "View saved"],
  nameRequired: ["请填写名称。", "Enter a name."],
  dateRequired: ["请选择有效日期。", "Choose a valid date."],
  textRequired: ["请填写内容。", "Enter some content."],
  templateTitle: ["使用人脉模板", "Use the people template"],
  templateBody: [
    "把人物背景、互动和下一次跟进放在一起。",
    "Keep people, conversations and the next follow-up together.",
  ],
  binding: ["资料从哪里来", "Where are the records?"],
  newFolder: ["新建资料文件夹", "Create a folder"],
  newFolderHint: ["从第一位联系人开始", "Start with your first person"],
  existingFolder: ["关联已有资料", "Use an existing folder"],
  existingHint: ["原文件保留在当前位置", "Original files stay where they are"],
  folder: ["资料位置", "Source folder"],
  folderPlaceholder: ["例如：生活/人脉", "For example: Life/People"],
  folderHelp: [
    "相对于当前知识库的文件夹路径。",
    "A folder path relative to the current knowledge library.",
  ],
  create: ["创建视图", "Create view"],
  openExisting: ["打开已有视图", "Open existing view"],
  previewTemplate: ["创建后会得到", "You will get"],
  templateResult: [
    "一个可以持续维护的人脉视图",
    "A people view you can keep using",
  ],
  templatePreviewLoading: ["正在核对资料…", "Checking records…"],
  existingPeople: ["已识别的人物", "Recognized people"],
  noRecognized: [
    "暂未识别到人物记录，已有文件仍会保留。",
    "No person records recognized yet. Existing files are retained.",
  ],
  newFolderEmpty: [
    "新文件夹为空，不填入演示联系人。",
    "The new folder is empty. No sample contacts are inserted.",
  ],
  existingAlready: [
    "此资料已有视图，将直接打开。",
    "This folder already has a view. It will open directly.",
  ],
  keptFiles: [
    "已有资料保留在原位置。",
    "Existing records remain in their original location.",
  ],
  templateSkill: ["配套会前准备指引", "Meeting preparation instructions"],
  recordFields: [
    "背景 · 互动 · 下一步",
    "Background · Interactions · Next step",
  ],
  limited: [
    "部分文件未读取，可在原文件中核对或缩小关联范围。",
    "Some files were not read. Check their originals or narrow the folder.",
  ],
  chooseFile: [
    "选择一个文件查看原文。",
    "Select a file to read its original content.",
  ],
  rootChanged: [
    "知识库发生变化，草稿已保留。请重新读取当前知识库。",
    "The knowledge library changed. Your draft was retained. Reload the current library.",
  ],
  requiredFields: [
    "请检查名称、内容、日期或资料路径。",
    "Check the name, content, date and folder path.",
  ],
  loadingPerson: ["正在读取人物资料…", "Loading person…"],
  sourceEmpty: ["尚未关联来源", "No associated sources yet"],
  linkedFolder: ["视图关联原资料", "Views use original records"],
  existingDoc: ["已有文档", "Existing document"],
  clear: ["清除", "Clear"],
  readOnly: ["原文件预览", "Original file preview"],
  notSaved: ["尚未保存", "Not saved yet"],
  folderExists: [
    "这个文件夹已存在，请选择关联已有资料。",
    "This folder exists. Choose an existing folder instead.",
  ],
  accessDenied: [
    "暂时不能读写这些资料，请检查目录或权限。",
    "These records could not be accessed. Check the folder and permissions.",
  ],
  requestFailed: [
    "读取或保存未完成，请保留草稿后重试。",
    "Reading or saving did not finish. Keep your draft and retry.",
  ],
  oversized: [
    "资料过大，请从原文件查看，或缩小关联范围。",
    "These records are too large. Open the original or narrow the folder.",
  ],
  repairHint: [
    "资料保留在新位置，重新关联不会移动原文件。",
    "Associate its current folder. Original files are not moved.",
  ],
} as const;
type TextKey = keyof typeof pairs;
export type ViewsCopy = { [K in TextKey]: string };
export function viewsCopy(locale: string): ViewsCopy {
  const index = locale === "zh" ? 0 : 1;
  return Object.fromEntries(
    Object.entries(pairs).map(([key, values]) => [key, values[index]]),
  ) as ViewsCopy;
}
export function viewErrorText(code: string, c: ViewsCopy): string {
  if (code === "ROOT_CHANGED") return c.rootChanged;
  if (code === "REVISION_CONFLICT" || code === "VIEW_CONFLICT")
    return c.conflictBody;
  if (code === "PERSON_MISSING") return c.personMissing;
  if (code === "FOLDER_MISSING" || code === "VIEW_MISSING")
    return c.folderMissing;
  if (code === "FOLDER_EXISTS" || code === "VIEW_EXISTS") return c.folderExists;
  if (code === "ACCESS_DENIED") return c.accessDenied;
  if (code === "DOCUMENT_TOO_LARGE" || code === "VIEW_LIMIT")
    return c.oversized;
  if (
    code === "INVALID_INPUT" ||
    code === "INVALID_FOLDER" ||
    code === "NO_MATERIALS"
  )
    return c.requiredFields;
  return c.requestFailed;
}
export const materialLabel = (id: string, c: ViewsCopy) =>
  ({
    background: c.background,
    followup: c.followup,
    interactions: c.interactions,
    sources: c.source,
  })[id as "background" | "followup" | "interactions" | "sources"];
