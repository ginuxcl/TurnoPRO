import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { Spinner } from './ui.jsx';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Schedule from './pages/Schedule.jsx';
import MyShifts from './pages/MyShifts.jsx';
import Requests from './pages/Requests.jsx';
import Staff from './pages/Staff.jsx';
import Availability from './pages/Availability.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Timeclock from './pages/Timeclock.jsx';
import Reports from './pages/Reports.jsx';
import Assistant from './pages/Assistant.jsx';

function RequireAuth({ children, manager = false }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spinner /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (manager && user.role === 'employee') return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  const { user, booting } = useAuth();
  return (
    <Routes>
      <Route path="/" element={booting ? <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spinner /></div> : (user ? <Navigate to="/app" replace /> : <Landing />)} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="horario" element={<RequireAuth manager><Schedule /></RequireAuth>} />
        <Route path="mis-turnos" element={<MyShifts />} />
        <Route path="solicitudes" element={<Requests />} />
        <Route path="equipo" element={<RequireAuth manager><Staff /></RequireAuth>} />
        <Route path="disponibilidad" element={<Availability />} />
        <Route path="asistente" element={<Assistant />} />
        <Route path="marcaje" element={<RequireAuth manager><Timeclock /></RequireAuth>} />
        <Route path="reportes" element={<RequireAuth manager><Reports /></RequireAuth>} />
        <Route path="ajustes" element={<RequireAuth manager><Settings /></RequireAuth>} />
        <Route path="auditoria" element={<RequireAuth manager><Audit /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
