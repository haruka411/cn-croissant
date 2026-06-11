import { Center, Checkbox, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { IconCpu } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { memo } from "react";
import { Trans } from "react-i18next";
import LocalImage from "@/components/common/LocalImage";
import { activeTabAtom, enginesAtom } from "@/state/atoms";
import { type LocalEngine, stopEngine } from "@/utils/engines";

function EngineBox({ engine, toggleEnabled }: { engine: LocalEngine; toggleEnabled: () => void }) {
  const activeTab = useAtomValue(activeTabAtom);

  return (
    <Paper
      withBorder
      p="sm"
      w="100%"
      h="3rem"
      onClick={() => {
        if (engine.loaded) {
          stopEngine(engine, activeTab!);
        }
        toggleEnabled();
      }}
      style={{ cursor: "pointer" }}
    >
      <Group wrap="nowrap">
        <Checkbox checked={!!engine.loaded} onChange={() => {}} />
        {engine.image ? (
          <LocalImage src={engine.image} alt={engine.name} w="1.5rem" />
        ) : (
          <IconCpu size="1.5rem" />
        )}
        <Text lineClamp={1} fz="sm">
          {engine.name}
        </Text>
      </Group>
    </Paper>
  );
}

function EngineSelection() {
  const [engines, setEngines] = useAtom(enginesAtom);
  const localEngines = (engines ?? []).filter(
    (engine): engine is LocalEngine => engine.type === "local",
  );

  if (!engines) return null;

  return (
    <>
      {localEngines.length === 0 && (
        <Center>
          <Text>
            <Trans
              i18nKey="Engines.Selection.None"
              components={{
                addEngineLink: <Link to="/engines" />,
              }}
            />
          </Text>
        </Center>
      )}

      <ScrollArea h={250} scrollbars="y">
        <Stack gap="xs" align="center" w="100%">
          {localEngines.map((engine) => (
            <EngineBox
              key={engine.name}
              engine={engine}
              toggleEnabled={() => {
                setEngines(async (prev) =>
                  (await prev)
                    .filter((e): e is LocalEngine => e.type === "local")
                    .map((e) => (e.name === engine.name ? { ...e, loaded: !e.loaded } : e)),
                );
              }}
            />
          ))}
        </Stack>
      </ScrollArea>
    </>
  );
}

export default memo(EngineSelection);
