// Маршрути — точно за docs/design/screens.md §0
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { RequireAuth, RequireRole } from './app/guards';
import { LoginPage } from './pages/LoginPage';
import { MainBoardPage } from './pages/MainBoardPage';
import { BackplateListPage } from './pages/backplates/BackplateListPage';
import { BackplateDetailPage } from './pages/backplates/BackplateDetailPage';
import { BackplateFormPage } from './pages/backplates/BackplateFormPage';
import { CylinderListPage } from './pages/cylinders/CylinderListPage';
import { CylinderDetailPage } from './pages/cylinders/CylinderDetailPage';
import { CylinderFormPage } from './pages/cylinders/CylinderFormPage';
import { ApparatusListPage } from './pages/apparatus/ApparatusListPage';
import { ApparatusDetailPage } from './pages/apparatus/ApparatusDetailPage';
import { ApparatusFormPage } from './pages/apparatus/ApparatusFormPage';
import { CompressorListPage } from './pages/compressors/CompressorListPage';
import { CompressorDetailPage } from './pages/compressors/CompressorDetailPage';
import { CompressorFormPage } from './pages/compressors/CompressorFormPage';
import { FillSessionWizardPage } from './pages/fillSession/FillSessionWizardPage';
import { SessionTimerPage } from './pages/fillSession/SessionTimerPage';
import { UsersPage } from './pages/admin/UsersPage';
import { UserFormPage } from './pages/admin/UserFormPage';
import { StationsPage } from './pages/admin/StationsPage';
import { StationFormPage } from './pages/admin/StationFormPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<MainBoardPage />} />

        <Route path="backplates" element={<BackplateListPage />} />
        <Route path="backplates/new" element={<BackplateFormPage />} />
        <Route path="backplates/:id" element={<BackplateDetailPage />} />
        <Route path="backplates/:id/edit" element={<BackplateFormPage />} />

        <Route path="cylinders" element={<CylinderListPage />} />
        <Route path="cylinders/new" element={<CylinderFormPage />} />
        <Route path="cylinders/:id" element={<CylinderDetailPage />} />
        <Route path="cylinders/:id/edit" element={<CylinderFormPage />} />

        <Route path="apparatus" element={<ApparatusListPage />} />
        <Route path="apparatus/new" element={<ApparatusFormPage />} />
        <Route path="apparatus/:id" element={<ApparatusDetailPage />} />
        <Route path="apparatus/:id/edit" element={<ApparatusFormPage />} />

        <Route path="compressors" element={<CompressorListPage />} />
        <Route path="compressors/new" element={<CompressorFormPage />} />
        <Route path="compressors/:id" element={<CompressorDetailPage />} />
        <Route path="compressors/:id/edit" element={<CompressorFormPage />} />

        {/* Майстер/адмін: запуск сесії; перегляд активної сесії — всі ролі */}
        <Route
          path="fill-session"
          element={
            <RequireRole roles={['admin', 'master']}>
              <FillSessionWizardPage />
            </RequireRole>
          }
        />
        <Route path="fill-session/:id" element={<SessionTimerPage />} />

        <Route
          path="admin/users"
          element={
            <RequireRole roles={['admin']}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/users/new"
          element={
            <RequireRole roles={['admin']}>
              <UserFormPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/users/:id"
          element={
            <RequireRole roles={['admin']}>
              <UserFormPage />
            </RequireRole>
          }
        />

        <Route
          path="admin/stations"
          element={
            <RequireRole roles={['admin']}>
              <StationsPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/stations/new"
          element={
            <RequireRole roles={['admin']}>
              <StationFormPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/stations/:id"
          element={
            <RequireRole roles={['admin']}>
              <StationFormPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
