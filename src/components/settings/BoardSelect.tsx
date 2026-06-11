import { Box, Group, Select, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { boardImageAtom, type XiangqiBoardTheme } from "@/state/atoms";

const boardThemes: { label: string; value: XiangqiBoardTheme; colors: [string, string, string] }[] =
  [
    { label: "经典木纹", value: "classic", colors: ["#d8a762", "#b77b3e", "#351b0c"] },
    { label: "青玉", value: "jade", colors: ["#b9d4ba", "#7da781", "#183c30"] },
    { label: "夜色", value: "dark", colors: ["#303843", "#1e252e", "#d3c3a4"] },
  ];

function ThemePreview({ colors }: { colors: [string, string, string] }) {
  return (
    <Box
      style={{
        width: 64,
        height: 32,
        flexShrink: 0,
        border: `2px solid ${colors[2]}`,
        background: `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`,
        position: "relative",
      }}
    >
      <Box
        style={{
          position: "absolute",
          left: "14%",
          right: "14%",
          top: "25%",
          bottom: "25%",
          borderTop: `1px solid ${colors[2]}`,
          borderBottom: `1px solid ${colors[2]}`,
        }}
      />
    </Box>
  );
}

export default function BoardSelect() {
  const [board, setBoard] = useAtom(boardImageAtom);
  const selected = boardThemes.find((item) => item.value === board) ?? boardThemes[0];

  return (
    <Select
      allowDeselect={false}
      w="13rem"
      data={boardThemes.map((item) => ({
        value: item.value,
        label: item.label,
      }))}
      value={selected.value}
      onChange={(value) => {
        if (value) setBoard(value as XiangqiBoardTheme);
      }}
      renderOption={({ option }) => {
        const item = boardThemes.find((theme) => theme.value === option.value)!;
        return (
          <Group wrap="nowrap">
            <ThemePreview colors={item.colors} />
            <Text fz="sm" fw={500}>
              {item.label}
            </Text>
          </Group>
        );
      }}
    />
  );
}
