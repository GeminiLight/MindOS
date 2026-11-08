'use client';
import { ContentPageShell } from '@/components/shared/ContentPageShell';
import { useLocale } from '@/lib/stores/locale-store';
import { EchoPageHeader } from '../EchoSegmentPageHeader';
import ResearchEntry from '../research/ResearchEntry';
import EchoLearningPanel from './EchoLearningPanel';

export default function EchoLearningPage() {
  const { t } = useLocale();
  return <ContentPageShell as="article" className="echo-content-page" aria-labelledby="learning-page-title">
    <EchoPageHeader p={t.echoPages} segment="learning" title={t.echoLearning.workspace.title}
      lead={t.echoLearning.workspace.lead} titleId="learning-page-title" />
    <div className="space-y-8">
      <EchoLearningPanel />
      <ResearchEntry />
    </div>
  </ContentPageShell>;
}
