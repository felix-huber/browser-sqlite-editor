import { useState, type ReactNode } from 'react'
import { OpenDatabaseButton } from './OpenDatabaseButton'
import { StatusBar } from './StatusBar'

interface AppShellProps {
  children?: ReactNode
  /** Callback when a SQLite file is selected via Open Database */
  onOpenDatabase?: (file: File) => void
  /** Callback when "New Database" is clicked */
  onNewDatabase?: () => void
}

export function AppShell({ children, onOpenDatabase, onNewDatabase }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="h-screen flex flex-col bg-navy-50 text-navy-900">
      {/* Header */}
      <Header
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenDatabase={onOpenDatabase}
        onNewDatabase={onNewDatabase}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar collapsed={sidebarCollapsed} />

        {/* Main Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-navy-50">
          {children}
        </main>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  )
}

interface HeaderProps {
  onToggleSidebar: () => void
  onOpenDatabase?: (file: File) => void
  onNewDatabase?: () => void
}

function Header({ onToggleSidebar, onOpenDatabase, onNewDatabase }: HeaderProps) {
  return (
    <header className="h-12 bg-white border-b border-navy-200 flex items-center px-4 gap-4 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 bg-navy-600 rounded-sm" />
        <span className="font-semibold text-sm tracking-tight">SQLite Editor</span>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-navy-200" />

      {/* Sidebar Toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 text-navy-500 hover:bg-navy-100 rounded transition-colors"
        aria-label="Toggle sidebar"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <OpenDatabaseButton onFileSelect={onOpenDatabase} />
        <button
          onClick={onNewDatabase}
          className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors"
          data-testid="header-new-database-button"
        >
          New Database
        </button>
      </div>

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors">
          Import
        </button>
        <button className="px-3 py-1.5 bg-navy-600 text-white text-sm font-medium rounded hover:bg-navy-700 transition-colors">
          Download
        </button>
        <button
          className="p-2 text-navy-500 hover:bg-navy-100 rounded transition-colors"
          title="Settings"
          aria-label="Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </header>
  )
}

interface SidebarProps {
  collapsed: boolean
}

function Sidebar({ collapsed }: SidebarProps) {
  if (collapsed) {
    return null
  }

  return (
    <aside className="w-60 bg-white border-r border-navy-200 flex flex-col shrink-0">
      {/* Search */}
      <div className="p-3 border-b border-navy-200">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search tables..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
          />
        </div>
      </div>

      {/* Tree View Placeholder */}
      <nav className="flex-1 min-h-0 overflow-y-auto p-2">
        <div className="text-sm text-navy-500 p-3 text-center">
          No database loaded
        </div>
      </nav>
    </aside>
  )
}

export default AppShell
