import { AppShell } from './components/layout/AppShell'
import { UpdateBanner } from './components/common/UpdateBanner'

function App() {
  return (
    <>
      <UpdateBanner />
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-navy-800">Welcome to SQLite Editor</h1>
            <p className="mt-2 text-navy-500">Open or create a database to get started.</p>
          </div>
        </div>
      </AppShell>
    </>
  )
}

export default App
