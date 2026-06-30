import { Box, Text } from "ink";

const LOGO_LINES = [
  "                         manage-tree                    ",
  "        __  __    __    _  _    __    ___  ____         ",
  "       (  \\/  )  /__\\  ( \\( )  /__\\  / __)( ___)        ",
  "        )    (  /(__)\\  )  (  /(__)\\( (_-. )__)         ",
  "       (_/\\/\\_)(__)(__)(_)\\_)(__)(__)\\___/(____)        ",
  "               git worktree manager                     ",
];

export function ManageTreeLogo() {
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
