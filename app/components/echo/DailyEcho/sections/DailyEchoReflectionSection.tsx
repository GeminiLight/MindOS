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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        {t.reflectionTitle || '❓ 明天思考'}
      </h3>

      <div className="space-y-3">
        {prompts.map((prompt, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-border/60 bg-muted/20 p-4"
          >
            <p className="text-sm text-foreground leading-relaxed">
              <span className="font-medium text-muted-foreground mr-2">
                Q{idx + 1}:
              </span>
              {prompt}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
