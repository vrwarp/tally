import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthProvider';
import { DataProvider } from '@/context/DataProvider';
import { ThemeProvider } from '@/context/ThemeProvider';
import { ToastProvider } from '@/context/ToastProvider';
import { AuthGate, RequireRole } from '@/features/auth/AuthGate';
import { LoginPage } from '@/features/auth/LoginPage';
import { ParentContactHost } from '@/features/students/ParentContactHost';
import { AppShell } from '@/components/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
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
  import('@/features/dashboard/DashboardPage').then((m) => ({
    default: m.DashboardPage,
  })),
);
const EventsPage = lazy(() =>
  import('@/features/events/EventsPage').then((m) => ({
    default: m.EventsPage,
  })),
);
const EventDetailPage = lazy(() =>
  import('@/features/events/EventDetailPage').then((m) => ({
    default: m.EventDetailPage,
  })),
);
const StudentsPage = lazy(() =>
  import('@/features/students/StudentsPage').then((m) => ({
    default: m.StudentsPage,
  })),
);
const StudentDetailPage = lazy(() =>
  import('@/features/students/StudentDetailPage').then((m) => ({
    default: m.StudentDetailPage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({
    default: m.SettingsPage,
  })),
);
const PairKioskPage = lazy(() =>
  import('@/features/settings/PairKioskPage').then((m) => ({
    default: m.PairKioskPage,
  })),
);
const ReviewPage = lazy(() =>
  import('@/features/review/ReviewPage').then((m) => ({
    default: m.ReviewPage,
  })),
);

export default function App() {
  return (
    <ErrorBoundary>
      {/* Outermost of the providers: the login screen and every error state
          need a theme too, and neither has an auth session yet. */}
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/*"
                element={
                  <AuthGate>
                    <DataProvider>
                      {/* Inside the roster, because the form refreshes it once
                          a write lands; outside every screen, because the lists
                          that open the form rewrite themselves underneath it as
                          their background reads settle. */}
                      <ParentContactHost>
                      <AppShell>
                        {/* Scoped per route: a lazy chunk that fails to load must
                          not take the app shell down with it. */}
                        <ErrorBoundary what="this screen">
                          <Suspense fallback={<LoadingScreen />}>
                            <Routes>
                              {/* Check-in is the home screen: a counselor at the door
                            should never have to navigate to start working. */}
                              <Route index element={<CheckInPage />} />
                              <Route
                                path="event/:eventId"
                                element={<CheckInPage />}
                              />

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
                              {/* Where a family the kiosk recorded becomes a
                                  family the church's database knows. Core team:
                                  this is the only screen that shows a parent's
                                  phone number, and the only one that writes
                                  people upstream. */}
                              <Route
                                path="review"
                                element={
                                  <RequireRole role="core">
                                    <ReviewPage />
                                  </RequireRole>
                                }
                              />
                              {/* Any active member: the person setting up the
                                  lobby kiosk on a Friday night is a counselor. */}
                              <Route path="pair-kiosk" element={<PairKioskPage />} />

                              <Route
                                path="*"
                                element={<Navigate to="/" replace />}
                              />
                            </Routes>
                        </Suspense>
                      </ErrorBoundary>
                    </AppShell>
                    </ParentContactHost>
                  </DataProvider>
                </AuthGate>
              }
            />
          </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
