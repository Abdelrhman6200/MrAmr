import { Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import CalendarPage from './pages/Calendar.jsx';
import Team from './pages/Team.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Calls from './pages/Calls.jsx';
import Centers from './pages/Centers.jsx';

function Routed() {
  const { user, booting, meta } = useApp();
  if (booting || !meta) return <div className="boot">…</div>;
  if (!user) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/calls" element={<Calls />} />
        <Route path="/centers" element={<Centers />} />
        <Route path="/team" element={<Team />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/users" element={<Users />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routed />
    </AppProvider>
  );
}
