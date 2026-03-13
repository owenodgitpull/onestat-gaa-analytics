import { useState } from 'react'
import { Settings as SettingsIcon, BookOpen, Users, Bell, Building2, ScrollText } from 'lucide-react'
import ClubProfileSettings from '../components/settings/ClubProfileSettings'
import KnowledgeBaseSettings from '../components/settings/KnowledgeBaseSettings'
import UserManagementSettings from '../components/settings/UserManagementSettings'
import NotificationSettings from '../components/settings/NotificationSettings'
import TeamManagementSettings from '../components/settings/TeamManagementSettings'
import AuditLogSettings from '../components/settings/AuditLogSettings'

const TABS = [
  { id: 'profile', label: 'Team Profile', icon: SettingsIcon },
  { id: 'teams', label: 'Teams', icon: Building2 },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'audit', label: 'Audit', icon: ScrollText },
] as const

type TabId = (typeof TABS)[number]['id']

export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl backdrop-blur-md" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-tour={`settings-tab-${id}`}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
              activeTab === id
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            <Icon size={16} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-2xl backdrop-blur-md p-6" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        {activeTab === 'profile' && <ClubProfileSettings />}
        {activeTab === 'teams' && <TeamManagementSettings />}
        {activeTab === 'knowledge' && <KnowledgeBaseSettings />}
        {activeTab === 'users' && <UserManagementSettings />}
        {activeTab === 'notifications' && <NotificationSettings />}
        {activeTab === 'audit' && <AuditLogSettings />}
      </div>
    </div>
  )
}
