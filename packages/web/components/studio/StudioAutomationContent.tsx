'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  readStudioProjects,
  STUDIO_PROJECTS_UPDATED_EVENT,
  type StudioProject,
} from '@/lib/studio-projects';
import { StudioShell } from './StudioShell';
import StudioAutomationSection from './StudioAutomationSection';

export default function StudioAutomationContent() {
  const { locale } = useLocale();
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());

  useEffect(() => {
    const syncProjects = () => setProjects(readStudioProjects());
    window.addEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
    window.addEventListener('storage', syncProjects);
    return () => {
      window.removeEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
      window.removeEventListener('storage', syncProjects);
    };
  }, []);

  return (
    <StudioShell contentMaxWidth="full">
      <div className="flex w-full min-w-0 flex-col gap-6">
        <StudioAutomationSection projects={projects} locale={locale} titleLevel={1} />
      </div>
    </StudioShell>
  );
}
