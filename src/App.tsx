import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthProvider';
import { DataProvider } from '@/context/DataProvider';
import { ToastProvider } from '@/context/ToastProvider';
import { AuthGate, RequireRole } from '@/features/auth/AuthGate';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from '@/components/AppShell';
import { CheckInPage } from '@/features/checkin/CheckInPage';
import { LoadingScreen } from '@/components/ui';

/*
 * Check-in and sign-in ship in the entry chunk; the core-team screens are
 * fetched on demand.
 *
 * Most people who install Tally are counselors who will only ever open the
 * roster, often on church wifi from a phone that has been in a pocket all week.
 * Making them download the dashboard, the event editor and the RSVP manager
 * before they can tap a single name is the wrong trade.
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const EventsPage = lazy(() =>
  import('@/features/events/EventsPage').then((m) => ({ default: m.EventsPage })),
);
const EventDetailPage = lazy(() =>
  import('@/features/events/EventDetailPage').then((m) => ({ default: m.EventDetailPage })),
);
const StudentsPage = lazy(() =>
  import('@/features/students/StudentsPage').then((m) => ({ default: m.StudentsPage })),
);
const StudentDetailPage = lazy(() =>
  import('@/features/students/StudentDetailPage').then((m) => ({ default: m.StudentDetailPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

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
                    <Suspense fallback={<LoadingScreen />}>
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
                    </Suspense>
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
