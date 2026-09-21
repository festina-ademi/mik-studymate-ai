import { MotionConfig } from 'framer-motion';
import { Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Route table. Providers (query client, router) are supplied by the caller. */
export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MotionConfig>
  );
}
