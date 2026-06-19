import { createFileRoute } from "@tanstack/react-router";
import XiangqiDatabasePanel from "@/components/xiangqi/XiangqiDatabasePanel";

export const Route = createFileRoute("/databases/$databaseId")({
  component: XiangqiDatabaseRoute,
});

function XiangqiDatabaseRoute() {
  return <XiangqiDatabasePanel />;
}
