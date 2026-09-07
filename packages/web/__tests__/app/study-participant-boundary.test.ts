import { it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
vi.mock('@/lib/runtime-auth-config', () => ({ readRuntimeAuthConfig: () => ({ webPassword: 'owner-password', authToken: 'owner-token', webSessionSecret: 'owner-secret' }) }));
it('routes only the exact participant surface to its own authorization boundary without wildcard CORS', async () => {
    const id = 'study-' + 'a'.repeat(24);
    for (const route of ['/study/participate/' + id, '/api/study/participate/' + id, '/api/study/participate/' + id + '/session']) {
        const res = await proxy(new NextRequest('http://localhost' + route));
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    for (const route of ['/api/study/participate/' + id + '/export', '/api/study/participate-other', '/api/echo/research'])
        expect((await proxy(new NextRequest('http://localhost' + route))).status).toBe(401);
    expect((await proxy(new NextRequest('http://localhost/'))).status).toBe(307);
});
it('keeps reviewer routes self-authorizing without opening adjacent owner routes', async () => {
  const id = 'study-' + 'a'.repeat(24);
  for (const route of ['/study/review/' + id, '/api/study/review/' + id, '/api/study/review/' + id + '/session']) {
    const response = await proxy(new NextRequest('http://localhost' + route));
    expect(response.status).toBe(200); expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  }
  expect((await proxy(new NextRequest('http://localhost/api/study/review/' + id + '/export'))).status).toBe(401);
});
it('keeps longitudinal participants outside vault data and restricts adjacent APIs',async()=>{
 const {shouldLoadShellData,shouldRenderShell}=await import('@/lib/shell-route');const id='cohort-'+'a'.repeat(24);
 expect(shouldLoadShellData('/study/longitudinal/'+id)).toBe(false);expect(shouldRenderShell('/study/longitudinal/'+id)).toBe(false);
 for(const route of ['/study/longitudinal/'+id,'/api/study/longitudinal/'+id,'/api/study/longitudinal/'+id+'/session']){const r=await proxy(new NextRequest('http://localhost'+route));expect(r.status).toBe(200);expect(r.headers.get('access-control-allow-origin')).toBeNull();}
 expect((await proxy(new NextRequest('http://localhost/api/study/longitudinal/'+id+'/export'))).status).toBe(401);
});
