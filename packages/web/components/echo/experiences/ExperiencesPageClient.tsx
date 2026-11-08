'use client';
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ChevronRight, FolderOpen, GitBranch, LoaderCircle, Play, RefreshCw, Search, Waypoints } from 'lucide-react';
import type { BranchStory, ReplaySource, ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { useLocale } from '@/lib/stores/locale-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { WorkbenchPageShell } from '@/components/shared/ContentPageShell';
import { Button } from '@/components/ui/button';
import { openTab } from '@/lib/workspace-tabs';
import { resumeExperience } from '@/lib/echo-experience-resume';
import { experienceProjects, experienceSourceKey, experienceTitle, recommendExperience, experienceInProgress, type ExperienceEpisode } from '@/lib/echo-experiences';
import { ReplayExperience } from '../replay/ReplayExperience';
import { ProjectDecisions } from './ProjectDecisions';
import { ExperienceEpisodeCard } from './ExperienceEpisodeCard';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useExperienceCatalog } from './useExperienceCatalog';
import './experiences.css';

const subscribe = () => () => {};
const ready = () => true, notReady = () => false;
function savedProgress(storyId?: string) {
  if (!storyId) return null;
  try { const value = JSON.parse(localStorage.getItem(`mindos:branch-replay:${storyId}`) || 'null'); return Array.isArray(value?.attempts) && value.attempts.length && Number.isInteger(value.sceneIndex) && value.sceneIndex >= 0 && ['choice','result','complete','unobserved'].includes(value.phase) ? value as { sceneIndex: number; phase: string } : null; } catch { return null; }
}
function BranchTrace({ count = 4 }: { count?: number }) {
  return <div className="experience-trace" aria-hidden="true"><svg viewBox="0 0 260 70" fill="none"><path d="M8 39H65C86 39 78 15 105 15H145C164 15 160 39 182 39H250M65 39C88 39 83 62 107 62H145M182 39C204 39 198 62 221 62H250"/><path className="experience-trace-active" d="M8 39H65C86 39 78 15 105 15H145C164 15 160 39 182 39H250"/>{Array.from({ length: Math.min(6, Math.max(2, count)) }, (_, i) => <circle key={i} cx={i === 0 ? 8 : i === 1 ? 65 : i === 2 ? 110 : i === 3 ? 145 : i === 4 ? 182 : 250} cy={i === 2 || i === 3 ? 15 : 39} r="4"/>)}</svg></div>;
}
function ExperiencesController() {
  const { locale } = useLocale(), zh = locale === 'zh', push = useSmoothRouterPush(), params = useSearchParams();
  const say = (cn: string, en: string) => zh ? cn : en;
  const { catalog, loading, analyzing, error, load, analyze, cancel, more } = useExperienceCatalog();
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false), [scope, setScope] = useState<'projects' | 'sessions'>('projects'), [allProjects, setAllProjects] = useState(false), [projectView, setProjectView] = useState<'journey'|'decisions'>('journey');
  const [story, setStory] = useState<BranchStory | null>(null), [storyLoading, setStoryLoading] = useState(false), [storyError, setStoryError] = useState('');
  const [original, setOriginal] = useState<ReplaySource | null>(null), [busy, setBusy] = useState(''), [actionError, setActionError] = useState('');
  const [draftConflict, setDraftConflict] = useState<{sessionId:string;draft:string}|null>(null);
  const hydrated = useSyncExternalStore(subscribe, ready, notReady);
  const projectId = params.get('project'), storyId = params.get('story'), sceneId = params.get('scene');
  const projects = useMemo(() => experienceProjects(catalog.sources), [catalog.sources]);
  const project = projects.find(value => value.id === projectId);
  const episodes = useMemo(() => new Map(catalog.episodes.map(episode => [experienceSourceKey(episode.source), episode])), [catalog.episodes]);
  const projectSources = project?.sources || [];
  const ordered = [...projectSources].sort((a, b) => (a.createdAt || a.updatedAt || 0) - (b.createdAt || b.updatedAt || 0));
  const playable = ordered.filter(source => episodes.get(experienceSourceKey(source))?.status === 'ready');
  const otherSources = ordered.filter(source => episodes.get(experienceSourceKey(source))?.status !== 'ready');
  const recommended = recommendExperience(playable.map(source => ({...episodes.get(experienceSourceKey(source))!,source})), episode => hydrated ? savedProgress(episode.storyId) : null);
  const recommendationProgress = recommended && hydrated ? savedProgress(recommended.storyId) : null;
  const currentSource = catalog.sources.find(source => `replay-${source.runtime}-${source.id}` === storyId);
  const activeIndex = playable.findIndex(source => `replay-${source.runtime}-${source.id}` === storyId);
  const remaining = projectSources.filter(source => !episodes.has(experienceSourceKey(source)));
  const autoScanned = useRef(new Set<string>()), actionLock = useRef(false);
  const loadedStory = useRef<string | null>(null), actionRequest = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; actionRequest.current?.abort(); }; }, []);
  useEffect(() => () => { actionRequest.current?.abort(); actionRequest.current = null; actionLock.current = false; if (alive.current) setBusy(''); }, [projectId, storyId, sceneId]);
  const date = (value?: number) => Number.isFinite(value) ? new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' }).format(value) : say('日期未知', 'Date unknown');
  function navigate(nextProject?: string, nextStory?: string, nextScene?: string) {
    const next = new URLSearchParams(); if (nextProject) next.set('project', nextProject); if (nextStory) next.set('story', nextStory); if (nextScene) next.set('scene', nextScene);
    actionRequest.current?.abort(); actionRequest.current = null; actionLock.current = false; setBusy('');
    if (nextProject !== projectId) setProjectView('journey');
    setOriginal(null); setDraftConflict(null); setActionError('');
    if (!nextProject && projectId) { setQuery(''); setArchived(false); void load(); }
    document.getElementById('main-content')?.scrollTo({top:0,behavior:'auto'}); window.history.pushState(null, '', '/echo/experiences' + (next.size ? `?${next}` : ''));
  }
  function open(source: ReplaySourceSummary, scene?: string) { navigate(source.projectId || projectId || undefined, `replay-${source.runtime}-${source.id}`, scene); }
  useEffect(() => {
    cancel();
    if (projectId && project && !autoScanned.current.has(projectId)) {
      autoScanned.current.add(projectId);
      const unprepared = project.sources.filter(source => !episodes.has(experienceSourceKey(source)));
      if (unprepared.length) void analyze(unprepared.slice(0, 8));
    }
    // Project changes cancel work; catalog updates never restart a failed/cancelled scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, !!project, analyze, cancel]);
  // URL navigation synchronizes the selected native story and its loading feedback.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!storyId) { loadedStory.current = null; setStory(null); return; }
    if (loadedStory.current === storyId) return;
    const match = /^replay-(claude|codex)-([\w-]{1,100})$/.exec(storyId);
    if (!match) { setStoryError(say('这段经历的链接不完整，请返回项目重新选择。', 'This experience link is invalid. Choose it again from the project.')); return; }
    const controller = new AbortController(); setStoryLoading(true); setStoryError(''); setStory(null);
    void (async () => {
      try {
        const response = await fetch('/api/echo/replays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runtime: match[1], sessionId: match[2] }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to open this experience.');
        if (!controller.signal.aborted) { loadedStory.current = storyId; setStory(data.story); }
      } catch (failure) { if (!controller.signal.aborted) setStoryError(failure instanceof Error ? failure.message : say('读取失败，请重试。', 'Could not load this experience.')); }
      finally { if (!controller.signal.aborted) setStoryLoading(false); }
    })();
    return () => controller.abort();
    // URL state is an external source; locale changes do not re-fetch a transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);
  async function read(source: ReplaySourceSummary) {
    if (actionLock.current) return; const controller = new AbortController(); actionRequest.current = controller; actionLock.current = true; setBusy(experienceSourceKey(source)); setActionError('');
    try {
      const response = await fetch('/api/echo/replays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runtime: source.runtime, sessionId: source.id, op: 'read' }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted && alive.current) setOriginal(data.source);
    } catch { if (!controller.signal.aborted && alive.current) setActionError(say('这段原文暂时无法读取，请稍后重试。', 'The original record could not be read. Please retry.')); }
    finally { if (actionRequest.current === controller) { actionRequest.current = null; actionLock.current = false; if (alive.current) setBusy(''); } }
  }
  async function resume(source: ReplaySourceSummary, takeaway?: string) {
    if (actionLock.current) return; const controller = new AbortController(); actionRequest.current = controller; actionLock.current = true; setBusy(experienceSourceKey(source)); setActionError('');
    try { const result = await resumeExperience(source, story || undefined, controller.signal, takeaway); if (controller.signal.aborted || !alive.current) return;
      if (!result.draftOffered) { setDraftConflict({ sessionId: result.sessionId, draft: result.draft }); return; }
      openTab('chat', result.sessionId, source.title, { pinned: true }); push(`/chat/${encodeURIComponent(result.sessionId)}`); }
    catch (failure) { if (!controller.signal.aborted && alive.current) setActionError(failure instanceof Error ? failure.message : say('续接失败，请重试。', 'Could not resume this session.')); }
    finally { if (actionRequest.current === controller) { actionRequest.current = null; actionLock.current = false; if (alive.current) setBusy(''); } }
  }
  useEffect(() => { if (error || actionError) document.getElementById('main-content')?.scrollTo({top:0,behavior:'auto'}); }, [error,actionError]);
  const sourceForResume = currentSource || (story ? { ...story.source, cwd: story.source.cwd } : null);
  return <WorkbenchPageShell className="experience-page mx-auto pb-10 pt-6 md:pt-8">
    <div className="experience-breadcrumb"><Link href="/echo/experiences" onClick={event=>{event.preventDefault();navigate();}}>{say('回响', 'Echo')}</Link><span>/</span><span>{say('项目经历', 'Project experiences')}</span><span className="experience-local">{say('本地记录 · 由你继续', 'Local records · Your next move')}</span></div>
    {(error || actionError) && <div className="experience-alert" role="alert"><span>{actionError || error}</span><Button variant="ghost" size="sm" onClick={() => { setActionError(''); void load(query, archived); }}>{say('刷新重试', 'Refresh and retry')}</Button></div>}
    {catalog.sourceErrors.map(item => <div key={item.runtime} role="status" className="experience-alert"><span>{item.runtime}: {item.error}</span><Button variant="ghost" size="sm" onClick={() => void load(query, archived)}>{say('重试', 'Retry')}</Button></div>)}
    {busy && <div className="experience-scan-status" role="status"><LoaderCircle size={15} className="animate-spin"/>{say('正在读取原会话…','Reading the original conversation…')}</div>}
    {storyId ? <>
      <div className="experience-return-bar"><Button variant="ghost" size="sm" onClick={() => navigate(projectId || undefined)}><ArrowLeft size={14}/>{project?.title || say('返回项目', 'Back to project')}</Button><span>{activeIndex >= 0 ? say(`第 ${activeIndex + 1} / ${playable.length} 段经历`, `Experience ${activeIndex + 1} of ${playable.length}`) : say('单段经历', 'One experience')}</span><div className="experience-inline-actions">
        {sourceForResume && !sourceForResume.archived && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void resume(sourceForResume)}>{say('带着判断继续工作', 'Continue in the original session')}<ArrowRight size={13}/></Button>}
        {story && <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/echo/workspace?sourceStory=${encodeURIComponent(story.id)}`}/>}>{say('一起工作', 'Work together')}<Waypoints size={13}/></Button>}
      </div></div>
      {storyLoading ? <div className="experience-empty" role="status"><LoaderCircle className="animate-spin"/>{say('正在打开当时的现场…', 'Opening the original experience…')}</div> : story ? <ReplayExperience key={`${story.id}:${sceneId || ''}`} story={story} locale={locale} initialSceneId={sceneId || undefined} onContinue={sourceForResume&&!sourceForResume.archived?takeaway=>void resume(sourceForResume,takeaway):undefined} continuing={!!busy}/> : <div className="experience-empty" role="alert"><p>{storyError}</p><Button variant="outline" onClick={() => navigate(projectId || undefined)}>{say('返回项目重新选择', 'Choose from the project')}</Button></div>}
      {playable.length > 1 && <nav className="experience-sequence" aria-label={say('项目经历顺序', 'Project sequence')}><Button variant="ghost" disabled={activeIndex <= 0} onClick={() => open(playable[activeIndex - 1])}><ArrowLeft size={14}/>{say('上一段', 'Previous')}</Button><p>{say('按记录时间串联；每段保留各自的证据。', 'Ordered by recorded time. Evidence stays with each session.')}</p><Button variant="outline" disabled={activeIndex < 0 || activeIndex >= playable.length - 1} onClick={() => open(playable[activeIndex + 1])}>{say('下一段经历', 'Next experience')}<ArrowRight size={14}/></Button></nav>}
    </> : <>
      <header className="experience-heading"><div><p className="experience-eyebrow">{project ? say('一个项目，一路走来的判断', 'The decisions behind a project') : say('从做过的事，到下一次判断', 'From past work to your next decision')}</p><h1>{project?.title || (projectId ? say('项目经历', 'Project experiences') : say('回到值得重走的地方', 'Return to a turning point'))}</h1><p>{project ? say('看看当时有哪些路可选，再带着新的理解继续。', 'Revisit the options, then carry your understanding forward.') : say('把散落在 Claude 和 Codex 里的经历，接成你自己的项目脉络。', 'Bring your Claude and Codex sessions together, one project at a time.')}</p></div>{project ? <Button variant="ghost" onClick={() => navigate()}><ArrowLeft size={14}/>{say('全部项目', 'All projects')}</Button> : <GitBranch size={30} className="experience-heading-mark"/>}</header>
      {!projectId && <div className="experience-controls"><div role="group" aria-label={say('浏览层级', 'Browse level')} className="experience-segment">{(['projects', 'sessions'] as const).map(value => <Button variant="ghost" size="sm" key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === 'projects' ? say('按项目', 'Projects') : say('单段会话', 'Sessions')}</Button>)}</div><form onSubmit={event => { event.preventDefault(); void load(query, archived); }} className="experience-search"><Search size={15}/><input aria-label={say('搜索项目或会话', 'Search projects or sessions')} placeholder={say('搜索项目或会话，Enter 查找', 'Project or session · Enter')} value={query} maxLength={160} onChange={event => { setQuery(event.target.value); if (!event.target.value) void load('', archived); }}/><Button variant="ghost" size="icon-sm" type="submit" aria-busy={loading} aria-label={say('搜索全部本地记录', 'Search all local records')}><ArrowRight size={14}/></Button></form><Button variant="ghost" size="icon-sm" disabled={loading} onClick={() => void load(query, archived)} aria-label={say('刷新本地记录', 'Refresh local records')}><RefreshCw size={15}/></Button></div>}
      {project ? <>
        <div className="experience-project-summary"><FolderOpen size={15}/><span title={project.path}>{project.path || say('目录未知', 'Unknown directory')}</span><span>{project.sources.length} {say('段已发现会话', 'discovered sessions')}</span><span>{playable.length} {say('段可重走', 'ready to replay')}</span></div>
        <div className="experience-project-start"><div><span className="experience-eyebrow">{recommended&&experienceInProgress(recommended,recommendationProgress)?say('接着上次的判断', 'Pick up where you paused'):say('建议从这段经历开始', 'A place to start')}</span><h2>{recommended ? experienceTitle(recommended.title || recommended.source.title,project.title) : say('正在寻找值得重走的经历', 'Finding an experience to revisit')}</h2><p>{recommended ? `${recommended.source.runtime==='claude'?'Claude':'Codex'} · ${recommended.decisions?.length} ${say('处决策', 'decision points')} · ${say('选路 → 看记录 → 换路对照 → 续接原会话', 'Choose → Observe → Compare → Continue your work')}` : say('没有明确取舍的会话也可以阅读原文，不会编造分支。', 'Conversations without documented choices remain available as original records.')}</p></div><Button variant="amber" disabled={!recommended} onClick={() => { if(recommended)open(recommended.source); }}><Play size={14}/>{recommended&&experienceInProgress(recommended,recommendationProgress)?say('接着重走', 'Continue replay'):recommendationProgress?say('回看这段经历','Revisit this experience'):say('开始这段回放', 'Start this experience')}</Button></div>
        {analyzing && <div className="experience-scan-status" role="status"><LoaderCircle size={15} className="animate-spin"/><span>{say('正在阅读最近的 8 段以内会话，保留真实取舍…', 'Reading up to 8 recent sessions for documented choices…')}</span><Button variant="ghost" size="sm" onClick={cancel}>{say('停止', 'Stop')}</Button></div>}
        <div className="experience-project-view" role="group" aria-label={say('项目浏览方式','Project view')}><Button variant="ghost" size="sm" aria-pressed={projectView === 'journey'} onClick={() => setProjectView('journey')}>{say('项目脉络','Journey')}</Button><Button variant="ghost" size="sm" aria-pressed={projectView === 'decisions'} onClick={() => setProjectView('decisions')}>{say('关键决策','Key decisions')} · {playable.reduce((count, source) => count + (episodes.get(experienceSourceKey(source))?.decisions?.length || 0), 0)}</Button></div>
        {projectView === 'decisions' ? <ProjectDecisions episodes={playable.map(source => ({...episodes.get(experienceSourceKey(source))!,source}))} locale={locale} onOpen={open}/> : <div className="experience-timeline">{playable.map(source => <ExperienceEpisodeCard key={experienceSourceKey(source)} source={source} episode={episodes.get(experienceSourceKey(source))} progress={hydrated ? savedProgress(episodes.get(experienceSourceKey(source))?.storyId) : null} locale={locale} analyzing={analyzing} busy={busy} open={open} read={read} resume={resume} analyze={analyze}/>)}</div>}
        {!!otherSources.length&&<details className="experience-other-sessions"><summary>{say('其它会话与原文', 'Other conversations and originals')} · {otherSources.length}<span>{say('未发现明确取舍或尚未整理', 'No documented choice yet, or not explored')}</span></summary><div>{otherSources.map(source=><ExperienceEpisodeCard key={experienceSourceKey(source)} source={source} episode={episodes.get(experienceSourceKey(source))} progress={null} locale={locale} analyzing={analyzing} busy={busy} open={open} read={read} resume={resume} analyze={analyze}/>)}</div></details>}
        {!!remaining.length && <div className="experience-more"><Button variant="outline" disabled={analyzing} onClick={() => void analyze(remaining.slice(0, 8))}>{say('继续梳理', 'Explore next')} {Math.min(8, remaining.length)} {say('段', 'sessions')}<ArrowRight size={14}/></Button><span>{remaining.length} {say('段尚未梳理', 'sessions not explored')}</span></div>}
      </> : projectId ? <div className="experience-empty"><p>{loading ? say('正在寻找这个项目…', 'Finding this project…') : say('当前目录页还没有这个项目。继续发现更早记录，或返回全部项目。', 'This project is outside the current page. Discover older sessions or return to all projects.')}</p><Button variant="outline" onClick={() => navigate()}>{say('全部项目', 'All projects')}</Button></div> : scope === 'projects' ? <div className="experience-project-grid">{projects.slice(0, allProjects ? undefined : 9).map(value => {
        const prepared = value.sources.map(source => episodes.get(experienceSourceKey(source))).filter((episode): episode is ExperienceEpisode => episode?.status === 'ready');
        const picked = recommendExperience(prepared,episode=>hydrated?savedProgress(episode.storyId):null);
        const resumed = picked && hydrated && experienceInProgress(picked,savedProgress(picked.storyId));
        return <button key={value.id} className="experience-project-tile" onClick={() => navigate(value.id)}><div className="experience-tile-top"><FolderOpen size={18}/><span>{date(value.sources[0]?.updatedAt)}</span></div><h2>{value.title}</h2><p className="experience-path" title={value.path}>{value.path || say('没有目录信息的会话', 'Sessions without a project directory')}</p><p className="experience-tile-topic">{experienceTitle(picked?.title || value.sources[0]?.title.slice(0,90) || '',value.title)}</p><BranchTrace count={value.sources.length}/><div className="experience-tile-bottom"><span>{value.sources.length} {say('段会话', 'sessions')} · {[...new Set(value.sources.map(s => s.runtime === 'claude' ? 'Claude' : 'Codex'))].join(' + ')}</span><ChevronRight size={16}/></div>{resumed && <span className="experience-resume-chip"><Play size={11}/>{say('继续上次回放', 'Continue your last replay')}</span>}</button>;
      })}</div> : <div className="experience-timeline">{catalog.sources.map(source => <ExperienceEpisodeCard key={experienceSourceKey(source)} source={source} episode={episodes.get(experienceSourceKey(source))} progress={hydrated ? savedProgress(episodes.get(experienceSourceKey(source))?.storyId) : null} locale={locale} analyzing={analyzing} busy={busy} open={open} read={read} resume={resume} analyze={analyze}/>)}</div>}
      {!projectId && scope === 'projects' && projects.length > 9 && <div className="experience-more"><Button variant="ghost" onClick={() => setAllProjects(value => !value)}>{allProjects ? say('收起较早项目', 'Show recent projects') : say(`查看其余 ${projects.length - 9} 个项目`, `Show ${projects.length - 9} more projects`)}</Button></div>}
      {loading && <div role="status" className="experience-scan-status"><LoaderCircle size={16} className="animate-spin"/>{say('正在发现本地经历…', 'Discovering local experiences…')}</div>}
      {!loading && !catalog.sources.length && <div className="experience-empty"><GitBranch size={25}/><h2>{say(query ? '没有找到匹配的经历' : '从一次真实工作开始', query ? 'No matching experiences' : 'Start with real work')}</h2><p>{say(query ? '试试项目目录、会话名称，或清空搜索。' : '在这台电脑使用 Claude Code 或 Codex 后，点击刷新即可发现。', query ? 'Try a project directory or session title, or clear the search.' : 'Use Claude Code or Codex on this computer, then refresh.')}</p><Link href="/echo/replay?story=replay-example-request-race">{say('先体验一段示例', 'Try an example first')} →</Link></div>}
    </>}

    {!storyId && <footer className="experience-footer"><div><span><Check size={13}/>{say('只在本地读取可见对话', 'Visible conversations, read locally')}</span><label><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); void load(query, event.target.checked); }}/>{say('包含 Codex 归档记录', 'Include archived Codex sessions')}</label></div><div><span>{catalog.sources.length} {say('段已发现', 'discovered')}</span>{(catalog.cursors.codex || catalog.cursors.claude) && <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>{say('发现更早记录', 'Discover older sessions')}<ArrowRight size={13}/></Button>}</div></footer>}

    <Dialog open={!!original} onOpenChange={open => { if (!open) setOriginal(null); }}><DialogContent className="max-w-3xl"><DialogTitle>{original?.title || say('原始会话','Original session')}</DialogTitle><DialogDescription>{say('只读原始对话；没有记录的后续不补写。','Read-only original conversation. Missing outcomes are not invented.')}</DialogDescription><div className="experience-original max-h-[65vh] overflow-y-auto">{original?.coverage?.truncated && <p>{say('长会话节选', 'Long session excerpt')} · {original.coverage.includedMessages} / {original.coverage.totalMessages}</p>}{original?.messages.map(message => <details key={message.id}><summary>{message.role === 'user' ? say('你当时说', 'You said') : original.runtime === 'claude' ? 'Claude' : 'Codex'} · {message.text.slice(0, 90)}</summary><p>{message.text}</p></details>)}</div></DialogContent></Dialog>
    <Dialog open={!!draftConflict} onOpenChange={open=>{if(!open)setDraftConflict(null);}}><DialogContent><DialogTitle>{say('原会话已有一份待接收的草稿','The original conversation has a pending draft')}</DialogTitle><DialogDescription>{say('已有草稿已保留。这次判断没有覆盖它；你可以先选中复制下面的文字，再打开原会话。','Your existing draft is preserved. Copy the new judgment below before opening the original conversation.')}</DialogDescription><textarea readOnly aria-label={say('本次续接草稿','This continuation draft')} value={draftConflict?.draft||''} rows={8} className="w-full rounded-lg border border-border bg-background p-3 text-sm leading-7"/><Button onClick={()=>{if(!draftConflict)return;openTab('chat',draftConflict.sessionId,sourceForResume?.title||say('原会话','Original conversation'),{pinned:true});push(`/chat/${encodeURIComponent(draftConflict.sessionId)}`);setDraftConflict(null);}}>{say('保留已有草稿，打开原会话','Open conversation with the existing draft')}</Button></DialogContent></Dialog>

  </WorkbenchPageShell>;
}
export default function ExperiencesPageClient() { return <Suspense><ExperiencesController/></Suspense>; }
