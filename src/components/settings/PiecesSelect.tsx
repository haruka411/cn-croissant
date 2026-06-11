import { Box, Flex, Group, Select } from "@mantine/core";
import { useAtom } from "jotai";
import { pieceSetAtom, type XiangqiPieceStyle } from "@/state/atoms";

const pieceStyles: { label: string; value: XiangqiPieceStyle }[] = [
  { label: "经典", value: "classic" },
  { label: "篆印", value: "seal" },
  { label: "素面", value: "plain" },
];

function PiecePreview({ value }: { value: XiangqiPieceStyle }) {
  const commonStyle = {
    width: "2.25rem",
    height: "2.25rem",
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    lineHeight: 1,
    border: "2px solid #5a2f12",
    color: "#b42124",
    fontFamily:
      value === "seal" ? '"STSong", "SimSun", serif' : '"KaiTi", "STKaiti", "SimSun", serif',
  } as const;

  return (
    <Flex gap={6}>
      <Box
        style={{
          ...commonStyle,
          background:
            value === "plain"
              ? "#f3d197"
              : "radial-gradient(circle at 34% 28%, rgba(255,255,255,.72), transparent 21%), radial-gradient(circle at 50% 56%, #f3d197 0 55%, #c98c4a 100%)",
          boxShadow:
            value === "plain" ? "0 3px 8px rgba(0,0,0,.22)" : "inset 0 -4px 6px rgba(83,42,13,.32)",
        }}
      >
        帅
      </Box>
      <Box
        style={{
          ...commonStyle,
          color: "#20242a",
          background: "#f3d197",
          boxShadow:
            value === "plain" ? "0 3px 8px rgba(0,0,0,.22)" : "inset 0 -4px 6px rgba(83,42,13,.32)",
        }}
      >
        将
      </Box>
    </Flex>
  );
}

export default function PiecesSelect() {
  const [pieceSet, setPieceSet] = useAtom(pieceSetAtom);
  const selected = pieceStyles.find((item) => item.value === pieceSet) ?? pieceStyles[0];

  return (
    <Group wrap="nowrap" gap="md">
      <PiecePreview value={selected.value} />
      <Select
        allowDeselect={false}
        w="10rem"
        data={pieceStyles}
        value={selected.value}
        onChange={(value) => {
          if (value) setPieceSet(value as XiangqiPieceStyle);
        }}
      />
    </Group>
  );
}
