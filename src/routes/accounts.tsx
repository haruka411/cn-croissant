import { createFileRoute } from "@tanstack/react-router";
import XiangqiPendingPage from "@/components/xiangqi/XiangqiPendingPage";

export const Route = createFileRoute("/accounts")({
  component: XiangqiAccountsRoute,
});

function XiangqiAccountsRoute() {
  return (
    <XiangqiPendingPage
      title="Online accounts are disabled"
      description="Chess.com and Lichess integrations do not apply to this Xiangqi build. This area will stay disabled unless a Xiangqi platform integration is added."
    />
  );
}
