/**
 * MindOS Logo — the Asymmetric Infinity (∞) symbol.
 *
 * Each instance needs a unique `id` to avoid SVG gradient ID collisions
 * when multiple logos render on the same page (e.g. Rail + Mobile header).
 */

interface LogoProps {
  /** Unique ID prefix for SVG gradient definitions */
  id: string;
  /** Tailwind className override — default: 'w-8 h-4' */
  className?: string;
}

export default function Logo({ id, className = 'w-8 h-4' }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 80 40"
      fill="none"
      className={`${className} text-[var(--amber)]`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`grad-human-${id}`} x1="35" y1="20" x2="5" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.8" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id={`grad-agent-${id}`} x1="35" y1="20" x2="75" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.8" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d="M35,20 C25,35 8,35 8,20 C8,5 25,5 35,20" stroke={`url(#grad-human-${id})`} strokeWidth="3" strokeDasharray="2 4" strokeLinecap="round" />
      <path d="M35,20 C45,2 75,2 75,20 C75,38 45,38 35,20" stroke={`url(#grad-agent-${id})`} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M35,17.5 Q35,20 37.5,20 Q35,20 35,22.5 Q35,20 32.5,20 Q35,20 35,17.5 Z" fill="#FEF3C7" />
    </svg>
  );
}
