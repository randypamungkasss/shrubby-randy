import type { ReactNode } from "react";
import { Box, Text } from "ink";

type FullscreenFrameProps = {
  readonly children: ReactNode;
  readonly columns: number;
  readonly footer: string;
  readonly rows: number;
};

export function FullscreenFrame({
  children,
  columns,
  footer,
  rows,
}: FullscreenFrameProps) {
  const width = Math.max(1, columns);
  const height = Math.max(1, rows);

  if (width < 12 || height < 5) {
    return (
      <Box width={width} height={height} overflow="hidden">
        <Text wrap="truncate">manage-tree</Text>
      </Box>
    );
  }

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      overflow="hidden"
    >
      <Box
        flexGrow={1}
        width="100%"
        alignItems="center"
        justifyContent="center"
        overflow="hidden"
      >
        {children}
      </Box>

      <Box height={1} justifyContent="center">
        <Text dimColor wrap="truncate">
          {footer}
        </Text>
      </Box>
    </Box>
  );
}
