import Link from 'next/link';
import ResearchPage from '@/components/echo/research/ResearchWorkspace';
export default function Page() { return <><div className="px-4 pt-4"><Link className="inline-flex min-h-11 items-center text-sm underline" href="/echo/research/longitudinal">Multi-round coevolution · 多轮共同进化</Link></div><ResearchPage /></>; }
