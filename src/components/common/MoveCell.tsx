import { Box, rgba, useMantineTheme } from "@mantine/core";
import { IconFlag } from "@tabler/icons-react";
import { useAtom } from "jotai";
import type { ReactNode, RefObject } from "react";
import { moveNotationTypeAtom } from "@/state/atoms";
import { addPieceSymbol } from "@/utils/moveNotation";
import classes from "./MoveCell.module.css";

interface MoveCellProps {
  isStart: boolean;
  isCurrentVariation: boolean;
  move: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  fullWidth?: boolean;
  rightAccessory?: ReactNode;
  ref?: RefObject<HTMLButtonElement>;
}

function MoveCell(props: MoveCellProps) {
  const [moveNotationType] = useAtom(moveNotationTypeAtom);
  const theme = useMantineTheme();
  const hoverOpacity = props.isCurrentVariation ? 0.25 : 0.1;
  const baseLight = theme.colors.gray[8];
  let hoverLight = rgba(theme.colors.gray[8], hoverOpacity);
  const baseDark = theme.colors.gray[1];
  let hoverDark = rgba(theme.colors.gray[1], hoverOpacity);
  let darkBg = "transparent";
  let lightBg = "transparent";

  if (props.isCurrentVariation) {
    darkBg = rgba(theme.colors.gray[6], 0.2);
    lightBg = rgba(theme.colors.gray[6], 0.2);
    hoverLight = rgba(lightBg, 0.25);
    hoverDark = rgba(darkBg, 0.25);
  }

  return (
    <Box
      ref={props.ref}
      component="button"
      className={`${classes.cell} ${props.fullWidth ? classes.cellFullWidth : ""}`}
      style={{
        "--light-color": baseLight,
        "--light-hover-color": hoverLight,
        "--dark-color": baseDark,
        "--dark-hover-color": hoverDark,
        "--dark-bg": darkBg,
        "--light-bg": lightBg,
      }}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
    >
      <Box component="span" className={classes.moveText}>
        {props.isStart && <IconFlag style={{ marginRight: 5 }} size="0.875rem" />}
        {moveNotationType === "symbols" ? addPieceSymbol(props.move) : props.move}
      </Box>
      {props.rightAccessory && (
        <Box component="span" className={classes.rightAccessory}>
          {props.rightAccessory}
        </Box>
      )}
    </Box>
  );
}

export default MoveCell;
