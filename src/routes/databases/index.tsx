import { createFileRoute } from "@tanstack/react-router";
import XiangqiPendingPage from "@/components/xiangqi/XiangqiPendingPage";

export const Route = createFileRoute("/databases/")({
  component: XiangqiDatabasesRoute,
});

function XiangqiDatabasesRoute() {
  return (
    <XiangqiPendingPage
      title="Xiangqi databases are not ready yet"
      description="The original database backend indexes chess PGN, ECO data and chess positions. This page is reserved for the Xiangqi database implementation."
    />
  );
}
