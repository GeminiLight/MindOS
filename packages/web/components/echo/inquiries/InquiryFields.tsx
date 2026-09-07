import type { InquiryCopy } from './inquiry-copy';
export const control =
  'min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const note = 'text-sm leading-6 text-muted-foreground';
export function InquiryFields({
  names,
  value,
  onChange,
  p,
  optional = false,
}: {
  names: string[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  p: InquiryCopy;
  optional?: boolean;
}) {
  return (
    <div className="space-y-4">
      {names.map((name) => (
        <label key={name} className="block space-y-2 text-sm font-medium">
          <span>{p[name as keyof InquiryCopy] as string}</span>
          <textarea
            className={control + ' w-full resize-y font-normal'}
            name={name}
            rows={name === 'question' || name === 'capability' ? 2 : 3}
            required={!optional}
            maxLength={
              [
                'question',
                'explanationA',
                'explanationB',
                'distinction',
                'task',
                'nextQuestion',
              ].includes(name)
                ? 4000
                : name === 'quote'
                  ? 1200
                  : 1600
            }
            value={value[name] ?? ''}
            onChange={(e) => onChange({ ...value, [name]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
