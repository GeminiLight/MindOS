'use client';

interface DailyEchoReflectionSectionProps {
  prompts: string[];
  locale?: { t: Record<string, any> };
}

export function DailyEchoReflectionSection({
  prompts,
  locale,
}: DailyEchoReflectionSectionProps) {
  const t = locale?.t || {};

  return (
    <section className="mb-8">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        {t.reflectionTitle || '明天思考'}
      </h3>

      <ol className="space-y-3 list-none">
        {prompts.map((prompt, idx) => (
          <li
            key={idx}
            className="rounded-lg border border-border/75 bg-muted/25 p-4"
          >
            <p className="text-sm text-foreground leading-relaxed">
              <span className="font-semibold text-[var(--amber)] mr-2">
                {idx + 1}.
              </span>
              {prompt}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
