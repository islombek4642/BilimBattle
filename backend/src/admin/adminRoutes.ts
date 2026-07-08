import { Router } from 'express';
import { requireAdminAuth } from './adminAuth';
import { getAdminSummary, getDailyStats, AdminSummary, DailyStat } from './statsQueries';

export const adminRouter = Router();

adminRouter.get('/admin/stats', requireAdminAuth, async (_req, res) => {
  const [summary, daily] = await Promise.all([getAdminSummary(), getDailyStats(14)]);
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderDashboard(summary, daily));
});

function renderDashboard(summary: AdminSummary, daily: DailyStat[]): string {
  const invitedPct = summary.totalUsers === 0 ? 0 : Math.round((summary.invitedUsers / summary.totalUsers) * 100);
  const returningPct = summary.totalUsers === 0 ? 0 : Math.round((summary.returningUsers / summary.totalUsers) * 100);

  const rows = daily
    .map(
      (d) => `<tr>
        <td>${d.date}</td>
        <td>${d.newUsers}</td>
        <td>${d.activeUsers}</td>
        <td>${d.humanMatches}</td>
        <td>${d.botMatches}</td>
      </tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>BilimBattle - Admin</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 24px; }
  .cards { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 32px; }
  .card { background: #1c1c1e; border-radius: 12px; padding: 16px 20px; min-width: 160px; }
  .card .value { font-size: 28px; font-weight: 700; }
  .card .label { font-size: 13px; color: #999; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; max-width: 720px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #2c2c2e; font-size: 14px; }
  th { color: #999; font-weight: 500; }
</style>
</head>
<body>
  <h1>BilimBattle - Admin statistikasi</h1>
  <div class="cards">
    <div class="card"><div class="value">${summary.totalUsers}</div><div class="label">Jami foydalanuvchilar</div></div>
    <div class="card"><div class="value">${summary.invitedUsers} (${invitedPct}%)</div><div class="label">Taklif orqali kelgan</div></div>
    <div class="card"><div class="value">${summary.returningUsers} (${returningPct}%)</div><div class="label">Qaytib o'ynagan (2+ kun)</div></div>
    <div class="card"><div class="value">${summary.totalHumanMatches}</div><div class="label">O'yinchi vs o'yinchi o'yinlar</div></div>
    <div class="card"><div class="value">${summary.totalBotMatches}</div><div class="label">Bot bilan o'yinlar</div></div>
  </div>
  <table>
    <thead>
      <tr><th>Sana</th><th>Yangi</th><th>Faol</th><th>O'yin (odam)</th><th>O'yin (bot)</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}
