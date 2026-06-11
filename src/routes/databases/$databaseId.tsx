import { createFileRoute } from "@tanstack/react-router";
import XiangqiPendingPage from "@/components/xiangqi/XiangqiPendingPage";

export const Route = createFileRoute("/databases/$databaseId")({
  component: XiangqiDatabaseRoute,
});

function XiangqiDatabaseRoute() {
  return (
    <XiangqiPendingPage
      title="Xiangqi database view is not ready yet"
      description="Existing database detail pages are chess-specific, so they are disabled until the Xiangqi database schema and search UI are implemented."
    />
  );
}
