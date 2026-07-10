// frontend/src/screens/AdminScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAdminStats } from '../api/admin';
import { openTelegramProfile } from '../telegram/webApp';
import { AdminStats } from '../api/types';
import { QuestionImportForm } from '../components/QuestionImportForm';

export function AdminScreen() {
  const { token } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setLoading(true);
    setError(false);

    getAdminStats(token)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-ios-red">Statistikani yuklab bo'lmadi.</p>
      </div>
    );
  }

  const { summary, daily, users } = stats;
  const invitedPct = summary.totalUsers === 0 ? 0 : Math.round((summary.invitedUsers / summary.totalUsers) * 100);
  const returningPct = summary.totalUsers === 0 ? 0 : Math.round((summary.returningUsers / summary.totalUsers) * 100);

  const cards: { label: string; value: string }[] = [
    { label: 'Jami foydalanuvchilar', value: String(summary.totalUsers) },
    { label: 'Taklif orqali kelgan', value: `${summary.invitedUsers} (${invitedPct}%)` },
    { label: "Qaytib o'ynagan", value: `${summary.returningUsers} (${returningPct}%)` },
    { label: "O'yinchi vs o'yinchi", value: String(summary.totalHumanMatches) },
    { label: 'Bot bilan', value: String(summary.totalBotMatches) },
  ];

  return (
    <div className="flex flex-col gap-5 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Admin statistikasi</h2>

      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
          >
            <div className="text-xl font-bold tabular-nums text-ios-label">{card.value}</div>
            <div className="mt-1 text-xs text-ios-secondary-label">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-ios-card shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ios-secondary-label">
              <th className="px-4 py-3">Sana</th>
              <th className="px-2 py-3">Yangi</th>
              <th className="px-2 py-3">Faol</th>
              <th className="px-2 py-3">O'yin</th>
              <th className="px-2 py-3">Bot</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.date} className="border-t border-ios-divider text-ios-label">
                <td className="px-4 py-2 tabular-nums">{day.date}</td>
                <td className="px-2 py-2 tabular-nums">{day.newUsers}</td>
                <td className="px-2 py-2 tabular-nums">{day.activeUsers}</td>
                <td className="px-2 py-2 tabular-nums">{day.humanMatches}</td>
                <td className="px-2 py-2 tabular-nums">{day.botMatches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-ios-card p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <h3 className="px-2 pt-2 text-sm font-semibold text-ios-label">Foydalanuvchilar</h3>
        {users.map((u, i) => {
          const clickable = u.username !== null;
          return (
            <button
              key={u.telegramId}
              type="button"
              disabled={!clickable}
              onClick={() => u.username && openTelegramProfile(u.username)}
              className={`flex items-center justify-between rounded-xl px-3 py-3 text-left ${
                i < users.length - 1 ? 'border-b border-ios-divider' : ''
              } ${clickable ? 'text-ios-blue' : 'text-ios-label'}`}
            >
              <span className="flex flex-col">
                <span className="font-medium">{u.firstName}</span>
                <span className="text-xs text-ios-secondary-label">
                  {u.username ? `@${u.username}` : "username yo'q"}
                </span>
              </span>
              <span className="text-xs tabular-nums text-ios-secondary-label">
                {u.rating} · {u.gamesPlayed} o'yin
              </span>
            </button>
          );
        })}
      </div>

      <QuestionImportForm />
    </div>
  );
}
