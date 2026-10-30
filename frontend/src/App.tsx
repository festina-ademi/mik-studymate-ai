import { MotionConfig } from 'framer-motion';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { RouteLoading } from './components/RouteLoading';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { WelcomePage } from './pages/WelcomePage';
import { WorkspacePage } from './pages/WorkspacePage';

// Code-split routes that a typical student visit never touches: the admin dashboard (which pulls
// in recharts, ~9 MB unminified) and the whole Study Mode experiment flow. Splitting these out of
// the main bundle keeps the landing-page-to-workspace path (what nearly every visit actually
// uses) small; see docs/DEPLOYMENT.md and the Phase 10 report for the measured effect.
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const StudyGuidePage = lazy(() =>
  import('./pages/StudyGuidePage').then((m) => ({ default: m.StudyGuidePage })),
);
const StudyPage = lazy(() => import('./pages/StudyPage').then((m) => ({ default: m.StudyPage })));
const StudyReturnPage = lazy(() =>
  import('./pages/StudyReturnPage').then((m) => ({ default: m.StudyReturnPage })),
);

/** Route table. Providers (query client, router) are supplied by the caller. */
export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />
          <Route path="welcome" element={<WelcomePage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route
            path="profile"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ProfilePage />
              </Suspense>
            }
          />
          <Route
            path="study"
            element={
              <Suspense fallback={<RouteLoading />}>
                <StudyGuidePage />
              </Suspense>
            }
          />
          {/* The thesis experiment: not in the navigation, participants open the link the
              researcher gives them (see docs/STUDY_PROTOCOL.md). */}
          <Route
            path="study/participate"
            element={
              <Suspense fallback={<RouteLoading />}>
                <StudyPage />
              </Suspense>
            }
          />
          <Route
            path="study/return"
            element={
              <Suspense fallback={<RouteLoading />}>
                <StudyReturnPage />
              </Suspense>
            }
          />
          <Route
            path="admin"
            element={
              <Suspense fallback={<RouteLoading />}>
                <AdminPage />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MotionConfig>
  );
}
