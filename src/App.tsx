import { HashRouter, Route, Routes } from "react-router";
import { ActivityPanel } from "./components/ActivityPanel";
import { AppProvider } from "./components/AppContext";
import { Shell } from "./components/Shell";
import { useAutoBackup, useProgressRecorder } from "./hooks/useBackground";
import { MyTasksPage } from "./pages/MyTasksPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { ProjectLayout } from "./pages/ProjectLayout";
import { OverviewTab } from "./pages/project/OverviewTab";
import { TimelineTab } from "./pages/project/TimelineTab";
import { BoardTab } from "./pages/project/BoardTab";
import { RaidTab } from "./pages/project/RaidTab";
import { ProjectReportsTab, ReportView } from "./pages/project/ReportsTab";
import { ReportsIndexPage } from "./pages/ReportsIndexPage";
import { SettingsPage } from "./pages/SettingsPage";

function Background() {
  useAutoBackup();
  useProgressRecorder();
  return null;
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Background />
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<PortfolioPage />} />
            <Route path="tasks" element={<MyTasksPage />} />
            <Route path="reports" element={<ReportsIndexPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="new" element={<NewProjectPage />} />
            <Route path="p/:projectId" element={<ProjectLayout />}>
              <Route index element={<OverviewTab />} />
              <Route path="timeline" element={<TimelineTab />} />
              <Route path="board" element={<BoardTab />} />
              <Route path="raid" element={<RaidTab />} />
              <Route path="reports" element={<ProjectReportsTab />} />
              <Route path="reports/:reportId" element={<ReportView />} />
            </Route>
            <Route path="*" element={<PortfolioPage />} />
          </Route>
        </Routes>
        <ActivityPanel />
      </HashRouter>
    </AppProvider>
  );
}
