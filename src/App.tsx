import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthProvider';
import { DataProvider } from '@/context/DataProvider';
import { ToastProvider } from '@/context/ToastProvider';
import { AuthGate, RequireRole } from '@/features/auth/AuthGate';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from '@/components/AppShell';
import { CheckInPage } from '@/features/checkin/CheckInPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { EventsPage } from '@/features/events/EventsPage';
import { EventDetailPage } from '@/features/events/EventDetailPage';
import { StudentsPage } from '@/features/students/StudentsPage';
import { StudentDetailPage } from '@/features/students/StudentDetailPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <AuthGate>
                <DataProvider>
                  <AppShell>
                    <Routes>
                      {/* Check-in is the home screen: a counselor at the door
                          should never have to navigate to start working. */}
                      <Route index element={<CheckInPage />} />
                      <Route path="event/:eventId" element={<CheckInPage />} />

                      <Route
                        path="dashboard"
                        element={
                          <RequireRole role="core">
                            <DashboardPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="events"
                        element={
                          <RequireRole role="core">
                            <EventsPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="events/:eventId"
                        element={
                          <RequireRole role="core">
                            <EventDetailPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="students"
                        element={
                          <RequireRole role="core">
                            <StudentsPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="students/:studentId"
                        element={
                          <RequireRole role="core">
                            <StudentDetailPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="settings"
                        element={
                          <RequireRole role="core">
                            <SettingsPage />
                          </RequireRole>
                        }
                      />

                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </AppShell>
                </DataProvider>
              </AuthGate>
            }
          />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
