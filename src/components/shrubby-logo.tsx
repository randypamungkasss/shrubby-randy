import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const TREE_FRAME_INTERVAL_MS = 280;

const TREE_FRAMES = [
  [
    "                 &&&                 ",
    "              &&&&&&&               ",
    "            &&&&\\|/&&&&             ",
    "                \\|/                 ",
    "                 |                  ",
    "                / \\                 ",
  ],
  [
    "                &&&                  ",
    "             &&&&&&&                ",
    "           &&&&\\|/&&&&              ",
    "               \\|/                  ",
    "                |                   ",
    "               / \\                  ",
  ],
  [
    "                  &&&                ",
    "               &&&&&&&              ",
    "             &&&&\\|/&&&&            ",
    "                 \\|/                ",
    "                  |                 ",
    "                 / \\                ",
  ],
] as const;

const LOGO_LINES = [
  "  ____  _   _ ____  _   _ ____  ____ __   __ ",
  " / ___|| | | |  _ \\| | | | __ )| __ )\\ \\ / / ",
  " \\___ \\| |_| | |_) | | | |  _ \\|  _ \\ \\ V /  ",
  "  ___) |  _  |  _ <| |_| | |_) | |_) | | |   ",
  " |____/|_| |_|_| \\_\\\\___/|____/|____/  |_|   ",
  "          git worktree manager                ",
];

export function ShrubbyLogo() {
  const [frameIndex, setFrameIndex] = useState(0);
  const treeFrame = TREE_FRAMES[frameIndex];

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((currentFrameIndex) =>
        (currentFrameIndex + 1) % TREE_FRAMES.length,
      );
    }, TREE_FRAME_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {treeFrame.map((line, index) => (
          <Text
            key={`${frameIndex}-${index}`}
            color={index < 3 ? "green" : "yellow"}
            bold={index < 3}
            wrap="truncate"
          >
            {line}
          </Text>
        ))}
      </Box>

      {LOGO_LINES.map((line) => (
        <Text key={line} color="cyan" bold wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}
