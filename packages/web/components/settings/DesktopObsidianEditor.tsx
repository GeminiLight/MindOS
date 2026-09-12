'use client';

import { planObsidianExecution } from '@/lib/obsidian-compat/runtime-plan';

import { useEffect, useId, useRef, useState } from 'react';
import { getDesktopBridge } from '@/lib/desktop-bridge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from './Primitives';

export function DesktopObsidianEditor({ plugins, disabled = false }: {
  plugins: readonly { id: string; name: string; compatibility?: { moduleImports?: string[]; unsupportedModules?: string[]; blockers: string[] } }[]; disabled?: boolean;
}) {
  const [available, setAvailable] = useState(false);
  const [chosen, setChosen] = useState('');
  const [filePath, setFilePath] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const pathId = useId();
  const canAttempt = (plugin: typeof plugins[number]) => !plugin.compatibility?.moduleImports || planObsidianExecution(plugin.compatibility).desktopCandidate;
  const pluginId = plugins.some(plugin => plugin.id === chosen) ? chosen : (plugins.find(canAttempt) ?? plugins[0])?.id ?? '';
  const selected = plugins.find(plugin => plugin.id === pluginId);
  const runnable = selected ? canAttempt(selected) : false;
  const missingModules = selected?.compatibility ? planObsidianExecution(selected.compatibility).desktopMissingModules : [];
  const validPath = filePath.length <= 1024 && /\.md$/i.test(filePath)
    && !/[\\:\x00-\x1f]/.test(filePath) && !filePath.split('/').some(part => !part || part.startsWith('.'));
  useEffect(() => {
    let mounted = true;
    const bridge = getDesktopBridge();
    if (bridge?.openObsidianEditor && bridge.getAppInfo) {
      void bridge.getAppInfo().then(info => { if (mounted) setAvailable(info.mode === 'local'); }).catch(() => {});
    }
    return () => { mounted = false; };
  }, []);
  if (!available || plugins.length === 0) return null;
  return <details className="border-t border-border pt-3">
    <summary className="cursor-pointer text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">桌面隔离编辑器（实验）</summary>
    <form className="mt-3 space-y-3" onSubmit={async event => {
      event.preventDefault();
      const bridge = getDesktopBridge();
      if (submitting.current || disabled || !runnable || !pluginId || !validPath || !bridge?.openObsidianEditor) return;
      submitting.current = true; setPending(true); setError(''); setStatus('等待桌面授权…');
      try {
        const result = await bridge.openObsidianEditor(pluginId, filePath);
        setStatus(result.opened ? '已打开独立编辑窗口。' : '已取消，未运行插件。');
      } catch (failure) { setStatus(''); setError(failure instanceof Error ? failure.message : '无法打开插件编辑器。'); }
      finally { submitting.current = false; setPending(false); }
    }}>
      <p className="text-xs text-muted-foreground">默认仅处理指定笔记；桌面授权时可额外勾选只读其他知识库文件，写入仍限当前笔记。插件配置会保存到当前知识库。此入口为实验功能，请及时保存笔记。</p>
      <div role="group" aria-label="运行的插件" className="space-y-1.5">
        <p className="text-sm font-medium">插件</p>
        <Select value={pluginId} onChange={event => setChosen(event.target.value)} disabled={disabled || pending}>
          {plugins.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}
        </Select>
      </div>
      {selected?.compatibility && <p className="text-xs text-muted-foreground">
        {runnable ? '已找到桌面运行所需模块；具体功能仍需验证，运行前会请求授权。' : `当前桌面宿主暂不能运行：${missingModules.join('、') || '包含无法解析的动态依赖'}。安装包仍保留。`}
      </p>}
      <Field label="笔记路径" htmlFor={pathId} hint="相对于当前知识库，例如 Notes/表格.md。">
        <Input id={pathId} value={filePath} onChange={event => setFilePath(event.target.value)} disabled={disabled || pending} maxLength={1024} placeholder="Notes/表格.md" />
      </Field>
      <Button type="submit" variant="amber" disabled={disabled || pending || !runnable || !pluginId || !validPath}>{pending ? '等待授权…' : '请求桌面运行'}</Button>
      {status ? <p role="status" className="text-xs text-muted-foreground">{status}</p> : null}
      {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
    </form>
  </details>;
}
