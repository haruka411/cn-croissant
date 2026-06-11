import { Alert, Stack, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

function XiangqiPendingPanel({ title, description }: { title: string; description: string }) {
  return (
    <Stack h="100%" p="sm">
      <Alert icon={<IconInfoCircle size="1rem" />} title={title} color="yellow">
        <Text size="sm">{description}</Text>
      </Alert>
    </Stack>
  );
}

export default XiangqiPendingPanel;
