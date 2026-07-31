function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function searchStream(fixtureUrl) {
  const video = {
    vod_id: 'fixture-video-1', vod_name: '验证视频 1', vod_pic: `${fixtureUrl}/poster.svg?item=1`,
    vod_remarks: '全2集', vod_year: '2026', type_name: '测试', source: 'fixture', sourceDisplayName: 'Fixture', latency: 20,
  };
  return [
    { type: 'start', totalSources: 1 },
    { type: 'videos', videos: [video], source: 'fixture', completedSources: 1, totalSources: 1, latency: 20 },
    { type: 'progress', completedSources: 1, totalSources: 1, totalVideosFound: 1 },
    { type: 'complete', totalVideosFound: 1, totalSources: 1, maxPageCount: 1 },
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join('');
}

export async function installMocks(page, ctx) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (url.origin === ctx.config.fixtureUrl) {
      const response = await route.fetch();
      return route.fulfill({ response });
    }
    if (pathname === '/api/auth/session') return json(route, { authenticated: false, session: null });
    if (pathname === '/api/auth' && request.method() === 'GET') return json(route, {
      hasAuth: false, persistSession: true, loginMode: 'none', subscriptionSources: '', iptvSources: '', mergeSources: '',
    });
    if (pathname === '/api/config') return json(route, { subscriptionSources: '' });
    if (pathname === '/api/app-update') {
      const release = { version: ctx.state.version, publishedAt: '2026-07-31', title: 'Verification fixture', notes: ['Deterministic browser response'] };
      return json(route, {
        currentVersion: ctx.state.version, currentRelease: release, latestVersion: ctx.state.version, latestRelease: release,
        status: 'up-to-date', updateAvailable: false, checkedAt: new Date().toISOString(), checkedRemotely: true,
        usedRemoteManifest: true, source: { repository: 'KuekHaoYang/KVideo', branch: 'main',
          manifestUrl: 'https://raw.githubusercontent.com/KuekHaoYang/KVideo/main/app-release.json',
          changelogUrl: 'https://github.com/KuekHaoYang/KVideo/blob/main/CHANGELOG.md', repositoryUrl: 'https://github.com/KuekHaoYang/KVideo' },
      });
    }
    if (pathname === '/api/search-parallel') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: searchStream(ctx.config.fixtureUrl) });
    if (pathname === '/api/detail') return json(route, { success: true, data: {
      vod_id: 'fixture-video-1', vod_name: '验证视频 1', vod_pic: `${ctx.config.fixtureUrl}/poster.svg?item=1`,
      vod_content: 'Deterministic browser fixture', vod_year: '2026', type_name: '测试',
      episodes: [{ name: '第1集', url: `${ctx.config.fixtureUrl}/test.mp4` }, { name: '第2集', url: `${ctx.config.fixtureUrl}/hls/master.m3u8` }],
    } });
    if (pathname === '/api/ping') return json(route, { latency: 20, success: true, timeout: false, method: 'HEAD' });
    if (pathname === '/api/probe-resolution') return json(route, { width: 640, height: 360, label: '360p' });
    if (pathname.startsWith('/api/user/')) return json(route, { history: [], favorites: [], config: null, success: true });
    if (pathname === '/api/premium/category') return json(route, { videos: [] });
    if (pathname === '/api/premium/types') return json(route, { tags: [{ id: 'recommend', label: '今日推荐', value: '' }] });
    if (pathname === '/api/danmaku') return json(route, []);
    if (pathname.startsWith('/api/douban/')) return json(route, { tags: [], subjects: [] });
    if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      return json(route, { error: 'verification mutation blocked' }, 403);
    }
    if (['www.gstatic.com', 'fastly.jsdelivr.net'].includes(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    return route.continue();
  });
}
