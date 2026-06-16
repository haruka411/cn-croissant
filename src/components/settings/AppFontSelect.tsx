import { Select } from "@mantine/core";
import { useAtom } from "jotai";
import { appFontFamilyAtom, type AppFontFamily } from "@/state/atoms";

const appFonts: { label: string; value: AppFontFamily }[] = [
  { label: "系统默认", value: "system" },
  { label: "微软雅黑", value: "microsoft-yahei" },
  { label: "黑体", value: "simhei" },
  { label: "宋体", value: "simsun" },
  { label: "楷体", value: "kaiti" },
  { label: "衬线", value: "serif" },
];

export default function AppFontSelect() {
  const [fontFamily, setFontFamily] = useAtom(appFontFamilyAtom);

  return (
    <Select
      allowDeselect={false}
      w="15rem"
      data={appFonts}
      value={fontFamily}
      onChange={(value) => {
        if (value) setFontFamily(value as AppFontFamily);
      }}
    />
  );
}
