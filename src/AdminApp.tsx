import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';

/* ------------------------------------------------------------------ types --- */

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

interface Job {
  id: string;
  mode: string;
  feeds: string[] | null;
  start?: number;
  end?: number;
  status: JobStatus;
  trigger: 'manual' | 'schedule';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  savedCount?: number;
  output?: string;
  error?: string;
}

interface Feed {
  key: string;
  url: string;
  articleCount: number;
}

interface Schedule {
  enabled: boolean;
  type: 'interval' | 'daily';
  intervalMinutes: number;
  dailyTime: string;
  mode: 'latest' | 'retry';
  feeds: string[] | null;
  catchUp: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastJobId: string | null;
  nextRunAt: string | null;
}

interface Stats {
  articles: { total: number; byChannel: Record<string, number>; latestDate: string | null };
  feeds: number;
  jobs: { total: number; running: boolean; activeJobId: string | null; lastCompletedAt: string | null };
  schedule: Schedule;
  storage: { articlesDir: string; articlesBytes: number; logFiles: number; logBytes: number };
}

interface LogFile {
  file: string;
  size: number;
  modified: string;
}

interface Channel {
  folder: string;
  en: string;
  zh: string;
  source: 'custom' | 'builtin' | 'derived';
  articleCount: number;
}

/* ------------------------------------------------------------------ utils --- */

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `请求失败 (${res.status})`);
  return data;
};

const jsonBody = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

const MODES = [
  { value: 'latest', label: '最新增量', hint: '扫描订阅源的最新文章' },
  { value: 'history', label: '历史区间', hint: '经互联网档案馆回溯历史快照' },
  { value: 'retry', label: '失败重试', hint: '重跑此前失败的快照节点' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '已超时',
  error: '启动失败',
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDuration = (ms?: number) => {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
};

const formatTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

/* ---------------------------------------------------------------- section --- */

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <h2 className="text-[24px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------- component --- */

export default function AdminApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordConfigured, setPasswordConfigured] = useState(true);
  const [password, setPassword] = useState('');
  const [booted, setBooted] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [logView, setLogView] = useState<{ file: string; content: string } | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState<{ en: string; zh: string }>({ en: '', zh: '' });

  const [mode, setMode] = useState<'latest' | 'history' | 'retry'>('latest');
  const [selectedFeeds, setSelectedFeeds] = useState<string[]>([]);
  const [startYear, setStartYear] = useState(2020);
  const [endYear, setEndYear] = useState(new Date().getFullYear());

  const [newFeedKey, setNewFeedKey] = useState('');
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [feedProbe, setFeedProbe] = useState<{ testing: boolean; ok?: boolean; text?: string } | null>(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const running = stats?.jobs.running ?? jobs.some(j => j.status === 'running');

  const refreshAll = useCallback(async () => {
    try {
      const [statsData, jobsData, feedsData, scheduleData, logsData, channelsData] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/jobs'),
        api('/api/admin/feeds'),
        api('/api/admin/schedule'),
        api('/api/admin/logs'),
        api('/api/admin/channels'),
      ]);
      setStats(statsData);
      setJobs(jobsData);
      setFeeds(feedsData);
      setSchedule(scheduleData);
      setLogs(logsData);
      setChannels(channelsData);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    api('/api/admin/session')
      .then(d => {
        setAuthenticated(d.authenticated);
        setPasswordConfigured(d.passwordConfigured !== false);
        if (d.authenticated) refreshAll();
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setBooted(true));
  }, [refreshAll]);

  useEffect(() => {
    if (!authenticated) return;
    const period = running ? 3000 : 15000;
    const timer = setInterval(refreshAll, period);
    return () => clearInterval(timer);
  }, [authenticated, running, refreshAll]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/admin/login', jsonBody({ password }));
      setAuthenticated(true);
      setPassword('');
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const logout = () =>
    api('/api/admin/logout', { method: 'POST' })
      .catch(() => undefined)
      .finally(() => {
        setAuthenticated(false);
        setStats(null);
        setJobs([]);
      });

  const runJob = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const body: Record<string, unknown> = { mode };
      if (selectedFeeds.length) body.feeds = selectedFeeds;
      if (mode === 'history') {
        body.start = startYear;
        body.end = endYear;
      }
      await api('/api/admin/jobs', jsonBody(body));
      setMessage('任务已启动');
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = (id: string) =>
    api(`/api/admin/jobs/${id}/cancel`, { method: 'POST' })
      .then(refreshAll)
      .catch(e => setError(e.message));

  const saveSchedule = async (patch: Partial<Schedule>) => {
    setError('');
    try {
      const next = await api('/api/admin/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setSchedule(next);
      setMessage('自动更新设置已保存');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addFeed = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/admin/feeds', jsonBody({ key: newFeedKey, url: newFeedUrl }));
      setNewFeedKey('');
      setNewFeedUrl('');
      setFeedProbe(null);
      setMessage('订阅源已添加');
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const testFeed = async () => {
    setError('');
    setMessage('');
    setFeedProbe({ testing: true });
    try {
      const data = await api('/api/admin/feeds/test', jsonBody({ url: newFeedUrl }));
      setFeedProbe({
        testing: false,
        ok: true,
        text: `可用 · ${data.items} 条条目${data.title ? ` · ${data.title}` : ''}`,
      });
    } catch (e: any) {
      setFeedProbe({ testing: false, ok: false, text: e.message });
    }
  };

  const removeFeed = async (key: string) => {
    setError('');
    try {
      await api(`/api/admin/feeds/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setSelectedFeeds(prev => prev.filter(f => f !== key));
      setMessage(`已移除订阅源 ${key}`);
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const openLog = async (file: string) => {
    try {
      const data = await api(`/api/admin/logs/${encodeURIComponent(file)}?bytes=40000`);
      setLogView(data);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pruneLogs = async () => {
    setError('');
    try {
      const data = await api('/api/admin/logs/prune', jsonBody({ days: 14 }));
      const removed: string[] = data.removed ?? [];
      setMessage(removed.length ? `已清理 ${removed.length} 个过期日志` : '没有超过 14 天的日志');
      setLogView(null);
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEditChannel = (channel: Channel) => {
    setEditingChannel(channel.folder);
    setChannelDraft({ en: channel.en, zh: channel.zh });
  };

  const saveChannel = async () => {
    if (!editingChannel) return;
    setError('');
    try {
      await api(`/api/admin/channels/${encodeURIComponent(editingChannel)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(channelDraft),
      });
      setEditingChannel(null);
      setMessage('频道名称已更新');
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const resetChannel = async (folder: string) => {
    setError('');
    try {
      await api(`/api/admin/channels/${encodeURIComponent(folder)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ en: null, zh: null }),
      });
      setEditingChannel(null);
      setMessage('已恢复默认名称');
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  /* ------------------------------------------------------------- login --- */

  if (!booted) {
    return <main className="min-h-screen bg-white" />;
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-white flex items-start justify-center px-6">
        <div className="w-full max-w-[380px] pt-[18vh] text-center">
          <h1 className="apple-display text-[40px] text-[#1d1d1f]">采集管理</h1>
          <p className="mt-3 text-[17px] text-gray-500 leading-[1.47]">
            {passwordConfigured ? '请输入管理员密码以继续。' : '服务端尚未配置 ADMIN_PASSWORD，管理后台已禁用。'}
          </p>
          {passwordConfigured && (
            <form onSubmit={login} className="mt-9 space-y-3 text-left">
              <input
                autoFocus
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="管理员密码"
                className="apple-focus w-full bg-[#f5f5f7] rounded-xl px-4 py-3 text-[17px] text-[#1d1d1f] placeholder-gray-400 outline-none"
              />
              <button
                type="submit"
                className="apple-focus apple-pill w-full bg-[#0071e3] hover:bg-[#0077ed] text-white py-3 text-[17px] transition-colors"
              >
                登录
              </button>
            </form>
          )}
          {error && <p className="mt-4 text-[14px] text-[#0071e3]">{error}</p>}
        </div>
      </main>
    );
  }

  /* ----------------------------------------------------------- console --- */

  return (
    <div className="min-h-screen bg-white text-[#1d1d1f]">
      <header className="apple-nav sticky top-0 z-20 h-12 px-6">
        <div className="max-w-[980px] mx-auto h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">FuzyRead</span>
            <span className="text-[12px] text-gray-400">采集管理</span>
          </div>
          <div className="flex items-center gap-4 text-[12px]">
            {running && <span className="text-[#0071e3]">任务运行中</span>}
            <a href="/" className="text-[#0066cc] hover:underline">阅读端</a>
            <button onClick={logout} className="apple-focus text-[#0066cc] hover:underline">退出</button>
          </div>
        </div>
      </header>

      <main className="max-w-[980px] mx-auto px-6 pb-24">
        {/* Overview */}
        <section className="pt-14 pb-8 sm:pt-20 sm:pb-10 text-center">
          <h1 className="apple-display text-[40px] sm:text-[48px]">采集控制台</h1>
          <p className="mt-3 text-[17px] text-gray-500 leading-[1.47]">
            {stats
              ? `${stats.articles.total} 篇文章 · ${stats.feeds} 个订阅源 · ${formatBytes(stats.storage.articlesBytes)}`
              : '正在载入…'}
          </p>
          {(message || error) && (
            <p className={`mt-3 text-[14px] ${error ? 'text-[#0071e3]' : 'text-gray-500'}`}>{error || message}</p>
          )}
        </section>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '文章总数', value: String(stats.articles.total) },
              { label: '最新日期', value: stats.articles.latestDate ?? '—' },
              { label: '自动更新', value: stats.schedule.enabled ? '已开启' : '已关闭' },
              { label: '下次运行', value: stats.schedule.nextRunAt ? formatTime(stats.schedule.nextRunAt).slice(5) : '—' },
            ].map(card => (
              <div key={card.label} className="bg-[#f5f5f7] rounded-2xl px-5 py-4">
                <p className="text-[12px] text-gray-500">{card.label}</p>
                <p className="mt-1 text-[19px] font-semibold tabular-nums">{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Auto-update schedule */}
        <Section title="自动更新">
          {schedule && (
            <div className="bg-[#f5f5f7] rounded-2xl p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[17px] font-semibold leading-[1.24]">定时自动采集</p>
                  <p className="mt-1 text-[14px] text-gray-500 leading-[1.35]">
                    {schedule.enabled
                      ? `下次运行 ${formatTime(schedule.nextRunAt)}`
                      : '开启后服务会按计划自动抓取最新文章'}
                  </p>
                </div>
                <button
                  onClick={() => saveSchedule({ enabled: !schedule.enabled })}
                  className={`apple-focus relative inline-flex h-[31px] w-[51px] items-center rounded-full transition-colors ${
                    schedule.enabled ? 'bg-[#0071e3]' : 'bg-[#d2d2d7]'
                  }`}
                  aria-label="切换自动更新"
                >
                  <span
                    className={`inline-block h-[27px] w-[27px] rounded-full bg-white transition-transform ${
                      schedule.enabled ? 'translate-x-[22px]' : 'translate-x-[2px]'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { value: 'daily', label: '每天固定时间', hint: '例如每天 03:00 抓一次' },
                  { value: 'interval', label: '固定间隔', hint: '例如每 360 分钟抓一次' },
                ] as const).map(option => (
                  <button
                    key={option.value}
                    onClick={() => saveSchedule({ type: option.value })}
                    className={`apple-focus rounded-xl px-5 py-4 text-left transition-colors ${
                      schedule.type === option.value ? 'bg-[#0071e3] text-white' : 'bg-white hover:bg-[#ededf0]'
                    }`}
                  >
                    <span className="block text-[15px] font-semibold leading-[1.24]">{option.label}</span>
                    <span className={`mt-1 block text-[12px] ${schedule.type === option.value ? 'text-white/75' : 'text-gray-500'}`}>
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-end gap-5">
                {schedule.type === 'daily' ? (
                  <label className="text-[12px] text-gray-500">
                    执行时间（服务器本地时区）
                    <input
                      type="time"
                      defaultValue={schedule.dailyTime}
                      onBlur={e => e.target.value !== schedule.dailyTime && saveSchedule({ dailyTime: e.target.value })}
                      className="apple-focus mt-1 block w-32 bg-white rounded-lg px-3 py-2 text-[15px] outline-none tabular-nums"
                    />
                  </label>
                ) : (
                  <label className="text-[12px] text-gray-500">
                    间隔分钟（最少 15）
                    <input
                      type="number"
                      min={15}
                      max={10080}
                      defaultValue={schedule.intervalMinutes}
                      onBlur={e => {
                        const value = Number(e.target.value);
                        if (value !== schedule.intervalMinutes) saveSchedule({ intervalMinutes: value });
                      }}
                      className="apple-focus mt-1 block w-32 bg-white rounded-lg px-3 py-2 text-[15px] outline-none tabular-nums"
                    />
                  </label>
                )}

                <label className="text-[12px] text-gray-500">
                  采集模式
                  <select
                    value={schedule.mode}
                    onChange={e => saveSchedule({ mode: e.target.value as 'latest' | 'retry' })}
                    className="apple-focus mt-1 block bg-white rounded-lg px-3 py-2 text-[15px] outline-none"
                  >
                    <option value="latest">最新增量</option>
                    <option value="retry">失败重试</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 text-[14px] text-gray-600">
                  <input
                    type="checkbox"
                    checked={schedule.catchUp}
                    onChange={e => saveSchedule({ catchUp: e.target.checked })}
                    className="apple-focus h-4 w-4 accent-[#0071e3]"
                  />
                  重启后补跑错过的计划
                </label>
              </div>

              <p className="mt-5 text-[12px] text-gray-500">
                上次触发 {formatTime(schedule.lastRunAt)}
                {schedule.lastStatus ? ` · ${STATUS_LABEL[schedule.lastStatus] ?? schedule.lastStatus}` : ''}
                {schedule.lastError ? ` · ${schedule.lastError}` : ''}
              </p>
            </div>
          )}
        </Section>

        {/* Manual job */}
        <Section title="手动采集">
          <div className="bg-[#f5f5f7] rounded-2xl p-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {MODES.map(m => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`apple-focus rounded-xl px-5 py-4 text-left transition-colors ${
                    mode === m.value ? 'bg-[#0071e3] text-white' : 'bg-white hover:bg-[#ededf0]'
                  }`}
                >
                  <span className="block text-[17px] font-semibold leading-[1.24]">{m.label}</span>
                  <span className={`mt-1 block text-[12px] leading-[1.33] ${mode === m.value ? 'text-white/75' : 'text-gray-500'}`}>
                    {m.hint}
                  </span>
                </button>
              ))}
            </div>

            {mode === 'history' && (
              <div className="mt-6 flex flex-wrap items-end gap-4">
                <label className="text-[12px] text-gray-500">
                  起始年份
                  <input
                    type="number"
                    value={startYear}
                    min={2000}
                    max={endYear}
                    onChange={e => setStartYear(Number(e.target.value))}
                    className="apple-focus mt-1 block w-28 bg-white rounded-lg px-3 py-2 text-[15px] outline-none tabular-nums"
                  />
                </label>
                <label className="text-[12px] text-gray-500">
                  结束年份
                  <input
                    type="number"
                    value={endYear}
                    min={startYear}
                    max={new Date().getFullYear() + 1}
                    onChange={e => setEndYear(Number(e.target.value))}
                    className="apple-focus mt-1 block w-28 bg-white rounded-lg px-3 py-2 text-[15px] outline-none tabular-nums"
                  />
                </label>
              </div>
            )}

            <div className="mt-7">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[17px] font-semibold leading-[1.24]">订阅源范围</h3>
                <button onClick={() => setSelectedFeeds([])} className="apple-focus text-[12px] text-[#0066cc] hover:underline">
                  全部（默认）
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {feeds.map(feed => {
                  const active = selectedFeeds.includes(feed.key);
                  return (
                    <button
                      key={feed.key}
                      onClick={() =>
                        setSelectedFeeds(prev => (active ? prev.filter(f => f !== feed.key) : [...prev, feed.key]))
                      }
                      className={`apple-focus apple-pill px-4 py-1.5 text-[12px] transition-colors ${
                        active ? 'bg-[#0071e3] text-white' : 'bg-white hover:bg-[#ededf0] text-gray-600'
                      }`}
                    >
                      {feed.key}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-gray-400">
                {selectedFeeds.length ? `已选择 ${selectedFeeds.length} 个订阅源` : '未选择时采集全部订阅源'}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <button
                disabled={busy || running}
                onClick={runJob}
                className="apple-focus apple-pill bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-40 disabled:hover:bg-[#0071e3] text-white px-6 py-2.5 text-[15px] transition-colors"
              >
                {busy ? '提交中…' : running ? '有任务运行中' : '开始采集'}
              </button>
              <button onClick={refreshAll} className="apple-focus text-[15px] text-[#0066cc] hover:underline">
                刷新状态
              </button>
            </div>
          </div>
        </Section>

        {/* Feeds */}
        <Section title="订阅源">
          <div className="rounded-2xl bg-[#f5f5f7] overflow-hidden">
            {feeds.length === 0 ? (
              <p className="px-8 py-12 text-center text-[15px] text-gray-500">暂无订阅源</p>
            ) : (
              <div className="divide-y divide-[#d2d2d7]">
                {feeds.map(feed => (
                  <div key={feed.key} className="px-6 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-[1.24]">{feed.key}</p>
                      <p className="mt-0.5 text-[12px] text-gray-500 break-all">{feed.url}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-[12px] text-gray-500 tabular-nums">{feed.articleCount} 篇</span>
                      <button
                        onClick={() => removeFeed(feed.key)}
                        className="apple-focus text-[12px] text-[#0066cc] hover:underline"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addFeed} className="px-6 py-5 sm:px-8 border-t border-[#d2d2d7]">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-[12px] text-gray-500 flex-1 min-w-[160px]">
                  标识
                  <input
                    value={newFeedKey}
                    onChange={e => setNewFeedKey(e.target.value)}
                    placeholder="guardian_world"
                    className="apple-focus mt-1 block w-full bg-white rounded-lg px-3 py-2 text-[14px] outline-none"
                  />
                </label>
                <label className="text-[12px] text-gray-500 flex-[2] min-w-[220px]">
                  RSS 地址
                  <input
                    value={newFeedUrl}
                    onChange={e => {
                      setNewFeedUrl(e.target.value);
                      setFeedProbe(null);
                    }}
                    placeholder="https://example.com/rss.xml"
                    className="apple-focus mt-1 block w-full bg-white rounded-lg px-3 py-2 text-[14px] outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={testFeed}
                  disabled={!newFeedUrl.trim() || feedProbe?.testing}
                  className="apple-focus apple-pill bg-white hover:bg-[#ededf0] px-5 py-2 text-[14px] transition-colors disabled:opacity-40"
                >
                  {feedProbe?.testing ? '测试中…' : '测试'}
                </button>
                <button
                  type="submit"
                  className="apple-focus apple-pill bg-[#0071e3] hover:bg-[#0077ed] text-white px-5 py-2 text-[14px] transition-colors"
                >
                  添加
                </button>
              </div>
              {feedProbe && !feedProbe.testing && (
                <p className={`mt-3 text-[12px] ${feedProbe.ok ? 'text-gray-500' : 'text-[#b3261e]'}`}>
                  {feedProbe.text}
                </p>
              )}
            </form>
          </div>
        </Section>

        {/* Channel display names */}
        <Section title="频道名称">
          <div className="rounded-2xl bg-[#f5f5f7] overflow-hidden">
            {channels.length === 0 ? (
              <p className="px-8 py-12 text-center text-[15px] text-gray-500">暂无频道</p>
            ) : (
              <div className="divide-y divide-[#d2d2d7]">
                {channels.map(channel => (
                  <div key={channel.folder} className="px-6 py-4 sm:px-8">
                    {editingChannel === channel.folder ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-[12px] text-gray-500 flex-1 min-w-[160px]">
                          英文名
                          <input
                            autoFocus
                            value={channelDraft.en}
                            onChange={e => setChannelDraft(d => ({ ...d, en: e.target.value }))}
                            className="apple-focus mt-1 block w-full bg-white rounded-lg px-3 py-2 text-[14px] outline-none"
                          />
                        </label>
                        <label className="text-[12px] text-gray-500 flex-1 min-w-[160px]">
                          中文名
                          <input
                            value={channelDraft.zh}
                            onChange={e => setChannelDraft(d => ({ ...d, zh: e.target.value }))}
                            className="apple-focus mt-1 block w-full bg-white rounded-lg px-3 py-2 text-[14px] outline-none"
                          />
                        </label>
                        <button
                          onClick={saveChannel}
                          className="apple-focus apple-pill bg-[#0071e3] hover:bg-[#0077ed] text-white px-5 py-2 text-[14px] transition-colors"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingChannel(null)}
                          className="apple-focus text-[12px] text-[#0066cc] hover:underline"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold leading-[1.24]">
                            {channel.zh}
                            <span className="ml-2 text-[12px] font-normal text-gray-500">{channel.en}</span>
                          </p>
                          <p className="mt-0.5 text-[12px] text-gray-500 break-all">
                            {channel.folder}
                            {channel.source === 'custom' ? ' · 自定义' : channel.source === 'derived' ? ' · 自动生成' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-[12px] text-gray-500 tabular-nums">{channel.articleCount} 篇</span>
                          <button
                            onClick={() => startEditChannel(channel)}
                            className="apple-focus text-[12px] text-[#0066cc] hover:underline"
                          >
                            重命名
                          </button>
                          {channel.source === 'custom' && (
                            <button
                              onClick={() => resetChannel(channel.folder)}
                              className="apple-focus text-[12px] text-[#0066cc] hover:underline"
                            >
                              恢复默认
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* Jobs */}
        <Section title="任务记录">
          {jobs.length === 0 ? (
            <div className="bg-[#f5f5f7] rounded-2xl px-8 py-14 text-center text-[15px] text-gray-500">暂无任务记录</div>
          ) : (
            <div className="rounded-2xl bg-[#f5f5f7] divide-y divide-[#d2d2d7] overflow-hidden">
              {jobs.map(job => {
                const expanded = openJob === job.id;
                return (
                  <article key={job.id} className="px-6 py-5 sm:px-8">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[17px] font-semibold leading-[1.24]">
                          {MODES.find(m => m.value === job.mode)?.label || job.mode}
                          {job.trigger === 'schedule' && (
                            <span className="ml-2 text-[12px] font-normal text-gray-500">自动</span>
                          )}
                        </h3>
                        <p className="mt-1 text-[12px] text-gray-500 tabular-nums">
                          {formatTime(job.startedAt)}
                          {job.durationMs ? ` · ${formatDuration(job.durationMs)}` : ''}
                          {typeof job.savedCount === 'number' ? ` · 新增 ${job.savedCount} 篇` : ''}
                          {job.feeds?.length ? ` · ${job.feeds.length} 个源` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-[12px] ${job.status === 'running' ? 'text-[#0071e3]' : 'text-gray-500'}`}>
                          {STATUS_LABEL[job.status] || job.status}
                        </span>
                        {job.status === 'running' && (
                          <button onClick={() => cancel(job.id)} className="apple-focus text-[12px] text-[#0066cc] hover:underline">
                            取消
                          </button>
                        )}
                        {job.output && (
                          <button
                            onClick={() => setOpenJob(expanded ? null : job.id)}
                            className="apple-focus text-[12px] text-[#0066cc] hover:underline"
                          >
                            {expanded ? '隐藏输出' : '查看输出'}
                          </button>
                        )}
                      </div>
                    </div>
                    {job.error && <p className="mt-2 text-[14px] text-[#0071e3]">{job.error}</p>}
                    {expanded && job.output && (
                      <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-white px-4 py-3 font-mono text-[12px] leading-[1.5] text-gray-700 whitespace-pre-wrap">
                        {job.output}
                      </pre>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </Section>

        {/* Logs */}
        <Section
          title="日志"
          action={
            <div className="flex items-center gap-4">
              {stats && (
                <span className="text-[12px] text-gray-500">
                  {stats.storage.logFiles} 个文件 · {formatBytes(stats.storage.logBytes)}
                </span>
              )}
              <button onClick={pruneLogs} className="apple-focus text-[12px] text-[#0066cc] hover:underline">
                清理 14 天前
              </button>
            </div>
          }
        >
          {logs.length === 0 ? (
            <div className="bg-[#f5f5f7] rounded-2xl px-8 py-12 text-center text-[15px] text-gray-500">暂无日志</div>
          ) : (
            <div className="rounded-2xl bg-[#f5f5f7] divide-y divide-[#d2d2d7] overflow-hidden">
              {logs.map(log => (
                <div key={log.file} className="px-6 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[15px] leading-[1.24]">{log.file}</p>
                    <p className="mt-0.5 text-[12px] text-gray-500 tabular-nums">
                      {formatBytes(log.size)} · {formatTime(log.modified)}
                    </p>
                  </div>
                  <button onClick={() => openLog(log.file)} className="apple-focus text-[12px] text-[#0066cc] hover:underline">
                    查看尾部
                  </button>
                </div>
              ))}
            </div>
          )}
          {logView && (
            <div className="mt-3 rounded-2xl bg-[#f5f5f7] p-6">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold">{logView.file}</p>
                <button onClick={() => setLogView(null)} className="apple-focus text-[12px] text-[#0066cc] hover:underline">
                  关闭
                </button>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-white px-4 py-3 font-mono text-[12px] leading-[1.5] text-gray-700 whitespace-pre-wrap">
                {logView.content || '(空)'}
              </pre>
            </div>
          )}
        </Section>
      </main>
    </div>
  );
}
