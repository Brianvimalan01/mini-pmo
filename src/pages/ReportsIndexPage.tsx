import { useLiveQuery } from "dexie-react-hooks";
import { EmptyState } from "../components/ui";
import { db } from "../db/db";
import { ReportList } from "./project/ReportsTab";

export function ReportsIndexPage() {
  const reports = useLiveQuery(() => db.reports.toArray(), []);
  if (!reports) return null;
  const sorted = [...reports].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <h1 className="text-lg font-semibold">Reports</h1>
      <p className="text-sm text-muted">Every weekly report across your projects, newest first.</p>
      <div className="mt-5">
        {sorted.length === 0 ? (
          <EmptyState title="No reports yet" body="Open a project and go to its Reports tab to generate this week's report in one click." />
        ) : (
          <ReportList reports={sorted} hrefFor={(r) => `/p/${r.projectId}/reports/${r.id}`} showProject />
        )}
      </div>
    </div>
  );
}
