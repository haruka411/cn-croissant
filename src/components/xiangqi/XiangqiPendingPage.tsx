import { Center, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

function XiangqiPendingPage({ title, description }: { title: string; description: string }) {
  return (
    <Center h="100%" p="md">
      <Paper withBorder p="xl" maw={620} w="100%">
        <Stack align="center" gap="sm">
          <ThemeIcon size={72} radius="100%" variant="light" color="yellow">
            <IconInfoCircle size={36} />
          </ThemeIcon>
          <Title order={2} ta="center">
            {title}
          </Title>
          <Text c="dimmed" ta="center">
            {description}
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}

export default XiangqiPendingPage;
