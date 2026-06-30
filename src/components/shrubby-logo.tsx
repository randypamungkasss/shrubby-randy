import { Box, Text } from "ink";

const LOGO_LINES = [
  "  ____  _   _ ____  _   _ ____  ____ __   __ ",
  " / ___|| | | |  _ \\| | | | __ )| __ )\\ \\ / / ",
  " \\___ \\| |_| | |_) | | | |  _ \\|  _ \\ \\ V /  ",
  "  ___) |  _  |  _ <| |_| | |_) | |_) | | |   ",
  " |____/|_| |_|_| \\_\\\\___/|____/|____/  |_|   ",
  "          git worktree manager                ",
];

export function ShrubbyLogo() {
  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line) => (
        <Text key={line} color="cyan" bold wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}
