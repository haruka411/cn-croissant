import { NumberInput, type NumberInputProps, Select } from "@mantine/core";
import { useState } from "react";
import { match } from "ts-pattern";
import type { GoMode } from "@/bindings";

export type TimeType = "ms" | "s" | "m" | "h";
function TimeInput({
  value,
  setValue,
  defaultType,
  type,
  onTypeChange,
  disabled,
  size,
}: {
  value: number;
  setValue: (v: GoMode) => void;
  defaultType?: TimeType;
  type?: TimeType;
  onTypeChange?: (type: TimeType) => void;
  disabled?: boolean;
  size?: NumberInputProps["size"];
}) {
  const [internalTimeType, setInternalTimeType] = useState<TimeType>(defaultType ?? "ms");

  const timeType = type ?? internalTimeType;
  const handleTypeChange = (newType: TimeType) => {
    if (onTypeChange) {
      onTypeChange(newType);
    } else {
      setInternalTimeType(newType);
    }
  };

  const displayedValue = match(timeType)
    .with("ms", () => value)
    .with("s", () => value / 1000)
    .with("m", () => value / 1000 / 60)
    .with("h", () => value / 1000 / 60 / 60)
    .exhaustive();

  return (
    <NumberInput
      size={size}
      disabled={disabled}
      min={0}
      decimalScale={2}
      allowDecimal={false}
      hideControls
      rightSection={
        <Select
          withCheckIcon={false}
          size={size}
          disabled={disabled}
          data={["ms", "s", "m", "h"]}
          defaultValue="ms"
          allowDeselect={false}
          value={timeType}
          withScrollArea={false}
          onChange={(v) => handleTypeChange(v as TimeType)}
          styles={{
            option: {
              wordBreak: "keep-all",
              overflow: "hidden",
            },
          }}
        />
      }
      rightSectionWidth={"30%"}
      value={displayedValue}
      onChange={(v) =>
        // setValue({ t: "Time", c: typeof v === "number" ? v : 1 })
        setValue({
          t: "Time",
          c:
            typeof v === "number"
              ? Math.round(
                  match(timeType)
                    .with("ms", () => v)
                    .with("s", () => v * 1000)
                    .with("m", () => v * 1000 * 60)
                    .with("h", () => v * 1000 * 60 * 60)
                    .exhaustive(),
                )
              : 1,
        })
      }
    />
  );
}

export default TimeInput;
