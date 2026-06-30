'use client';

import { useEffect } from 'react';
import { Bot } from 'lucide-react';
import { DEFAULT_AGENT_MAX_STEPS, type AiTabProps, type AgentSettings } from '../types';
import { Field, Input, Select, SettingCard, SettingRow, Toggle } from '../Primitives';
import { MaxStepsSelect } from './MaxStepsSelect';

export function AgentBehaviorCard({
  agent,
  supportsThinking,
  updateAgent,
  t,
}: {
  agent: AgentSettings | undefined;
  supportsThinking: boolean;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  t: AiTabProps['t'];
}) {
  useEffect(() => {
    const retries = agent?.reconnectRetries ?? 3;
    try {
      localStorage.setItem('mindos-reconnect-retries', String(retries));
    } catch (err) {
      console.warn('[AgentBehaviorCard] localStorage setItem reconnectRetries failed:', err);
    }
  }, [agent?.reconnectRetries]);

  return (
    <SettingCard
      icon={<Bot size={15} />}
      title={t.settings.agent.title}
      description={t.settings.agent.subtitle ?? 'Configure how the AI agent operates'}
    >
      <SettingRow label={t.settings.agent.maxSteps} hint={t.settings.agent.maxStepsHint}>
        <MaxStepsSelect value={agent?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS} onChange={value => updateAgent({ maxSteps: value })} />
      </SettingRow>

      <SettingRow label={t.settings.agent.contextStrategy} hint={t.settings.agent.contextStrategyHint}>
        <Select
          value={agent?.contextStrategy ?? 'auto'}
          onChange={event => updateAgent({ contextStrategy: event.target.value as 'auto' | 'off' })}
          className="w-24"
        >
          <option value="auto">{t.settings.agent.contextStrategyAuto}</option>
          <option value="off">{t.settings.agent.contextStrategyOff}</option>
        </Select>
      </SettingRow>

      <SettingRow label={t.settings.agent.reconnectRetries} hint={t.settings.agent.reconnectRetriesHint}>
        <Select
          value={String(agent?.reconnectRetries ?? 3)}
          onChange={event => {
            const retries = Number(event.target.value);
            updateAgent({ reconnectRetries: retries });
            try {
              localStorage.setItem('mindos-reconnect-retries', String(retries));
            } catch (err) {
              console.warn('[AgentBehaviorCard] localStorage setItem reconnectRetries failed:', err);
            }
          }}
          className="w-20"
        >
          <option value="0">Off</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </Select>
      </SettingRow>

      {supportsThinking && (
        <>
          <SettingRow label={t.settings.agent.thinking} hint={t.settings.agent.thinkingHint}>
            <Toggle checked={agent?.enableThinking ?? false} onChange={() => updateAgent({ enableThinking: !(agent?.enableThinking ?? false) })} />
          </SettingRow>

          {agent?.enableThinking && (
            <Field label={t.settings.agent.thinkingBudget} hint={t.settings.agent.thinkingBudgetHint}>
              <Input
                type="number"
                value={String(agent?.thinkingBudget ?? 5000)}
                onChange={event => {
                  const nextValue = parseInt(event.target.value, 10);
                  if (!isNaN(nextValue)) updateAgent({ thinkingBudget: Math.max(1000, Math.min(50000, nextValue)) });
                }}
                min={1000}
                max={50000}
                step={1000}
              />
            </Field>
          )}
        </>
      )}
    </SettingCard>
  );
}
