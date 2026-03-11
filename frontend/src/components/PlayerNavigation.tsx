import { Link, useLocation } from 'react-router-dom';
import { Home, Trophy, BarChart3, UserCircle, ClipboardList } from 'lucide-react';

const tabs = [
  { icon: Home, label: 'Dashboard', path: '/player' },
  { icon: Trophy, label: 'Leaderboards', path: '/player/leaderboards' },
  { icon: ClipboardList, label: 'Playbook', path: '/player/playbooks' },
  { icon: BarChart3, label: 'My Stats', path: '/player/stats' },
  { icon: UserCircle, label: 'Profile', path: '/player/profile' },
];

export default function PlayerNavigation() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/player' && location.pathname === '/player') return true;
    if (path !== '/player' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-2xl border-t border-white/[0.12] safe-area-bottom"
      style={{
        background: 'linear-gradient(180deg, rgba(15, 15, 30, 0.95), rgba(10, 10, 25, 0.98))',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                active ? 'text-orange-400' : 'text-white/40'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mb-0.5 transition-all ${
                  active
                    ? 'bg-orange-500/15 shadow-lg shadow-orange-500/20'
                    : ''
                }`}
              >
                <tab.icon size={22} strokeWidth={active ? 2.5 : 1.5} />
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-orange-400' : 'text-white/40'}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
