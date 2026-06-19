import { createFileRoute } from "@tanstack/react-router";
import XiangqiDatabasePanel from "@/components/xiangqi/XiangqiDatabasePanel";

export const Route = createFileRoute("/databases/")({
  component: XiangqiDatabasesRoute,
});

function XiangqiDatabasesRoute() {
  return <XiangqiDatabasePanel />;
}
