import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../../design/tokens.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './shell';
import { BoardPage } from './pages/Board';
import { AppsPage } from './pages/Apps';
import { AppView } from './pages/AppView';
import { ProjectsPage } from './pages/Projects';
import { ProjectView } from './pages/ProjectView';
import { TicketView } from './pages/TicketView';
import { SettingsPage } from './pages/Settings';
import { TrashPage } from './pages/Trash';
import { NotFound } from './pages/Entity';

// Come back to the window and you see what the CLI (or an agent) did while you
// were away; the board adds a 5 s poll of its own on top (ADR-0004).
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 1_000, refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<BoardPage />} />
            <Route path="apps" element={<AppsPage />} />
            <Route path="apps/:slugId" element={<AppView />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:slugId" element={<ProjectView />} />
            <Route path="tickets/:key" element={<TicketView />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="*" element={<NotFound what="page" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
